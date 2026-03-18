import express from "express";
import Parser from "rss-parser";
import axios from "axios";
import * as cheerio from "cheerio";

const app = express();
const PORT = 3000;

app.use(express.json());

const parser = new Parser({
  customFields: {
    item: ['media:content', 'media:thumbnail', 'content:encoded', 'description']
  }
});

// Predefined list of news sources with historical bias/credibility data
const NEWS_SOURCES = [
  { id: 'cnn', name: 'CNN', url: 'http://rss.cnn.com/rss/cnn_topstories.rss', type: 'Mainstream', bias: 'Left', credibility: 'Low' },
  { id: 'fox', name: 'Fox News', url: 'https://moxie.foxnews.com/google-publisher/latest.xml', type: 'Mainstream', bias: 'Right', credibility: 'Low' },
  { id: 'bbc', name: 'BBC News', url: 'http://feeds.bbci.co.uk/news/rss.xml', type: 'Mainstream', bias: 'Center', credibility: 'Low' },
  { id: 'reuters', name: 'Reuters', url: 'https://news.google.com/rss/search?q=when:24h+source:Reuters&hl=en-US&gl=US&ceid=US:en', type: 'Mainstream', bias: 'Center', credibility: 'Low' },
  { id: 'ap', name: 'Associated Press', url: 'https://news.google.com/rss/search?q=when:24h+source:Associated_Press&hl=en-US&gl=US&ceid=US:en', type: 'Mainstream', bias: 'Center', credibility: 'Low' },
  { id: 'intercept', name: 'The Intercept', url: 'https://theintercept.com/feed/?lang=en', type: 'Independent', bias: 'Left', credibility: 'High' },
  { id: 'propublica', name: 'ProPublica', url: 'https://www.propublica.org/feeds/propublica/main', type: 'Independent', bias: 'Center', credibility: 'High' },
  { id: 'democracynow', name: 'Democracy Now!', url: 'https://www.democracynow.org/democracynow.rss', type: 'Independent', bias: 'Left', credibility: 'High' },
  { id: 'jacobin', name: 'Jacobin', url: 'https://jacobin.com/feed', type: 'Independent', bias: 'Left', credibility: 'High' },
  { id: 'aljazeera', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', type: 'Independent', bias: 'Center', credibility: 'High' },
  { id: 'zerohedge', name: 'ZeroHedge', url: 'http://feeds.feedburner.com/zerohedge/feed', type: 'Alternative', bias: 'Right', credibility: 'Mixed' },
  { id: 'breitbart', name: 'Breitbart', url: 'https://www.breitbart.com/feed/', type: 'Alternative', bias: 'Right', credibility: 'Mixed' },
  { id: 'epoch', name: 'Epoch Times', url: 'https://news.google.com/rss/search?q=when:24h+source:The_Epoch_Times&hl=en-US&gl=US&ceid=US:en', type: 'Alternative', bias: 'Right', credibility: 'Mixed' },
];

app.get("/api/sources", (req, res) => {
  res.json(NEWS_SOURCES);
});

app.get("/api/news", async (req, res) => {
  try {
    const allNews = [];
    
    // Fetch from all sources in parallel
    await Promise.allSettled(
      NEWS_SOURCES.map(async (source) => {
        try {
          // Use axios with a strict timeout to prevent Vercel 10s limit crashes
          const response = await axios.get(source.url, { 
            timeout: 4000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });
          const feed = await parser.parseString(response.data);
          
          const items = feed.items.slice(0, 5).map((item: any) => ({
            id: btoa(encodeURIComponent(item.link || item.guid || Math.random().toString())),
            title: item.title,
            link: item.link,
            pubDate: item.pubDate,
            source: source.name,
            sourceType: source.type,
            sourceBias: source.bias,
            sourceCredibility: source.credibility,
            contentSnippet: item.contentSnippet || item.description || '',
            creator: item.creator || item.author || 'Unknown'
          }));
          allNews.push(...items);
        } catch (err: any) {
          console.error(`Error fetching RSS for ${source.name}:`, err.message);
        }
      })
    );
    
    // Sort by date descending
    allNews.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    
    res.json(allNews);
  } catch (error) {
    console.error("Error fetching news:", error);
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

app.post("/api/scrape", async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 8000
    });
    
    const $ = cheerio.load(response.data);
    
    // Remove scripts, styles, nav, header, footer to get main content
    $('script, style, nav, header, footer, aside, iframe, .ads, .advertisement').remove();
    
    // Try to find main article content
    let articleText = '';
    if ($('article').length > 0) {
      articleText = $('article').text();
    } else if ($('main').length > 0) {
      articleText = $('main').text();
    } else {
      articleText = $('body').text();
    }
    
    // Clean up text
    articleText = articleText.replace(/\s+/g, ' ').trim();
    
    // Truncate to avoid massive payloads (Gemini can handle a lot, but let's be safe)
    if (articleText.length > 20000) {
      articleText = articleText.substring(0, 20000) + '...';
    }
    
    res.json({ text: articleText });
  } catch (error: any) {
    console.error(`Error scraping ${url}:`, error.message);
    res.status(500).json({ error: "Failed to scrape article content. The site might be blocking bots." });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  // Only listen if not running in Vercel's serverless environment
  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();

// Export the Express API for Vercel serverless functions
export default app;
