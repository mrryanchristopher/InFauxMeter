import express from "express";
import { createServer as createViteServer } from "vite";
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
  { id: 'cnn', name: 'CNN', url: 'http://rss.cnn.com/rss/cnn_topstories.rss', type: 'Mainstream', bias: 'Left', credibility: 'High' },
  { id: 'fox', name: 'Fox News', url: 'https://moxie.foxnews.com/google-publisher/latest.xml', type: 'Mainstream', bias: 'Right', credibility: 'Mixed' },
  { id: 'bbc', name: 'BBC News', url: 'http://feeds.bbci.co.uk/news/rss.xml', type: 'Mainstream', bias: 'Center', credibility: 'High' },
  { id: 'nyt', name: 'New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', type: 'Mainstream', bias: 'Left', credibility: 'High' },
  { id: 'reuters', name: 'Reuters', url: 'https://news.google.com/rss/search?q=when:24h+source:Reuters&hl=en-US&gl=US&ceid=US:en', type: 'Mainstream', bias: 'Center', credibility: 'High' },
  { id: 'ap', name: 'Associated Press', url: 'https://news.google.com/rss/search?q=when:24h+source:Associated_Press&hl=en-US&gl=US&ceid=US:en', type: 'Mainstream', bias: 'Center', credibility: 'High' },
  { id: 'intercept', name: 'The Intercept', url: 'https://theintercept.com/feed/?lang=en', type: 'Alternative', bias: 'Left', credibility: 'High' },
  { id: 'propublica', name: 'ProPublica', url: 'https://www.propublica.org/feeds/propublica/main', type: 'Alternative', bias: 'Left', credibility: 'High' },
  { id: 'zerohedge', name: 'ZeroHedge', url: 'http://feeds.feedburner.com/zerohedge/feed', type: 'Alternative', bias: 'Right', credibility: 'Mixed' },
  { id: 'democracynow', name: 'Democracy Now!', url: 'https://www.democracynow.org/democracynow.rss', type: 'Alternative', bias: 'Left', credibility: 'High' },
  { id: 'breitbart', name: 'Breitbart', url: 'https://www.breitbart.com/feed/', type: 'Alternative', bias: 'Right', credibility: 'Mixed' },
  { id: 'jacobin', name: 'Jacobin', url: 'https://jacobin.com/feed', type: 'Alternative', bias: 'Left', credibility: 'High' },
  { id: 'aljazeera', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', type: 'Mainstream', bias: 'Center', credibility: 'High' },
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
          const feed = await parser.parseURL(source.url);
            const items = feed.items.slice(0, 5).map((item: any) => ({
              id: Buffer.from(item.link || item.guid || Math.random().toString()).toString('base64'),
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
      timeout: 10000
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
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
