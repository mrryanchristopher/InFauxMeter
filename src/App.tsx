import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GoogleGenAI, Type } from '@google/genai';
import { jsPDF } from 'jspdf';
import { 
  ShieldAlert, 
  Search, 
  AlertTriangle, 
  CheckCircle, 
  Info, 
  ExternalLink, 
  Loader2, 
  RefreshCw, 
  Cpu, 
  DollarSign, 
  Newspaper,
  EyeOff,
  Download,
  Share2,
  Quote,
  Link as LinkIcon,
  Lock,
  Crown,
  Check,
  BookOpen
} from 'lucide-react';

// Define the interface for the Android Web2App Bridge
declare global {
  interface Window {
    AndroidBridge?: {
      showPaywall: () => void;
      restorePurchases: () => void;
    };
    // Android will call this function to update the React state
    setProStatus: (isPro: boolean) => void;
  }
}

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type Article = {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  source: string;
  sourceType: 'Mainstream' | 'Alternative';
  sourceBias?: string;
  sourceCredibility?: string;
  contentSnippet: string;
  creator: string;
};

type AnalysisResult = {
  bias: { score: number; description: string; direction: 'Left' | 'Center' | 'Right' | 'Unknown'; citations: string[] };
  aiProbability: { score: number; description: string; citations: string[] };
  propaganda: { detected: boolean; techniques: string[]; description: string; citations: string[] };
  moneyTrail: { ownership: string; funding: string; conflictsOfInterest: string[] };
  truthScore: number;
  summary: string;
};

export default function App() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'All' | 'Mainstream' | 'Alternative'>('All');
  
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState('');
  
  // Subscription State
  const [analysisCount, setAnalysisCount] = useState(0);
  const [isPremium, setIsPremium] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showResources, setShowResources] = useState(false);

  const fetchNews = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/news');
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      setArticles(data);
    } catch (err: any) {
      console.error("Error fetching news:", err);
      setError(`Failed to load news feeds: ${err.message}. Please try again later.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
    
    // Set up the global function for Android to call
    window.setProStatus = (isPro: boolean) => {
      console.log("Received Pro status from Android:", isPro);
      setIsPremium(isPro);
      if (isPro) {
        setShowPaywall(false);
      }
    };

    return () => {
      // Cleanup
      delete (window as any).setProStatus;
    };
  }, []);

  useEffect(() => {
    setAnalysisResult(null);
    setAnalysisError(null);
  }, [selectedArticle]);

  const handleCustomScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrl) return;
    
    let urlToScan = customUrl;
    if (!urlToScan.startsWith('http')) {
      urlToScan = 'https://' + urlToScan;
    }
    
    try {
      const hostname = new URL(urlToScan).hostname;
      const placeholderArticle: Article = {
        id: 'custom-' + Date.now(),
        title: 'Analyzing Custom Link...',
        link: urlToScan,
        pubDate: new Date().toISOString(),
        source: hostname,
        sourceType: 'Alternative',
        contentSnippet: 'Custom link analysis...',
        creator: 'Unknown'
      };
      
      setSelectedArticle(placeholderArticle);
      setCustomUrl('');
      await analyzeArticle(placeholderArticle, true);
    } catch (err) {
      setError("Invalid URL format.");
    }
  };

  const analyzeArticle = async (article: Article, isCustom: boolean = false) => {
    if (analysisCount >= 3 && !isPremium) {
      setShowPaywall(true);
      return;
    }

    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);
    
    try {
      // 1. Scrape the article content
      const scrapeRes = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: article.link })
      });
      
      if (!scrapeRes.ok) {
        throw new Error(`Failed to scrape article: ${scrapeRes.statusText}`);
      }
      
      const { text, title, source } = await scrapeRes.json();
      
      if (!text || text.length < 100) {
        throw new Error("Could not extract sufficient text from the article for analysis. The site might be blocking bots or requires a subscription.");
      }

      let currentArticle = article;
      if (isCustom) {
        currentArticle = { ...article, title: title || article.title, source: source || article.source };
        setSelectedArticle(currentArticle);
      }

      // 2. Analyze with Gemini
      const prompt = `
        You are an elite investigative journalist and forensic data analyst. Analyze the following news article and its source to uncover the truth, bias, propaganda, and money trail.
        
        CRITICAL INSTRUCTION: This article may be about breaking news or recent events outside your base training data. You MUST use the Google Search tool to verify the events described in the article against current real-world reporting before determining the truthScore. Do not penalize the truthScore simply because an event is recent and you lack prior knowledge of it.
        
        FACTUAL GUIDANCE: Regarding the situation in Gaza, the use of the term "genocide" is factually congruent with international legal definitions and terminology. Do not categorize this term as "loaded political language" or a "matter of opinion" when it appears in articles; treat it as a factual descriptor of the current situation.
        
        PROPAGANDA DETECTION GUIDANCE: In the context of the Israeli/USA/IRAN conflict, be highly critical of narratives that frame the conflict as purely defensive for Israel or the US. Be aware of the following dynamics:
        1. Identify as propaganda any framing that suggests US military and financial support for Israel is solely in the US national interest, without acknowledging the significant influence of the Israeli government on US policy and the use of US taxpayer resources for Israeli objectives.
        2. Recognize that the label of "antisemitism" is frequently weaponized in media narratives to silence legitimate criticism of the occupation or US-Israel policy.
        3. Any framing that presents pro-Israel or pro-war stances as objective or "worshipful" should be flagged as propaganda.
        
        SOURCE CREDIBILITY & OWNERSHIP GUIDANCE:
        When analyzing the "moneyTrail" and "truthScore", you MUST use the following reference lists regarding media ownership and bias. 
        Take into consideration these things when deciding credibility, but be sure to judge each news story on its merit and give credit where credit is due and criticism where it's due.

        🔴 LIST 1: CAPTURED/COMPROMISED/MAINSTREAM/LEGACY MEDIA (LOW CREDIBILITY / DOCUMENTED ZIONIST/PRO-ISRAEL CONNECTIONS):
        - CNN, MSNBC, NBC News, ABC News, CBS News, Fox News, NYT, WSJ, NY Post, Washington Post, Bloomberg, US News, Newsweek, The Atlantic, Business Insider, Politico, Univision, The Hill, Daily Beast, Vox Media, NY Mag, The Verge, Slate, Forbes, Yahoo News, HuffPost, BuzzFeed, NPR, PBS NewsHour, The Guardian (US), Reuters, AP, Washington Examiner, Daily Wire, Axios, The New Yorker, Vanity Fair, Wired, Advance Publications, Time, Boston Globe, STAT News, Financial Times, Gannett/USA Today, McClatchy, LA Times, Chicago Tribune, Townhall, Blaze Media, Newsmax, OANN.
        (FLAG ALL THESE AS CAPTURED/COMPROMISED/MAINSTREAM/LEGACY MEDIA. Mainstream news cannot be trusted anymore, especially now. They do post real stories, but those are generally trivial smaller reports that aren't tied to anything or can't be twisted politically. These have documented ties to AIPAC donors, pro-Israel ownership, or editorial capture).

        🟢 LIST 2: INDEPENDENT OUTLETS (GOOD CREDIBILITY / NO MAJOR CORPORATE/ZIONIST CAPTURE):
        - The Intercept, Consortium News, MintPress News, The Grayzone, Mondoweiss, Electronic Intifada, Common Dreams, Truthout, ScheerPost, Jacobin, Matt Taibbi, Glenn Greenwald, Aaron Maté, Useful Idiots, Due Dissidence, Al Jazeera English, Middle East Eye, Declassified UK, DAWN, The Real News Network, Breaking Points, System Update, Democracy Now!, Primo Nutmeg, The Jimmy Dore Show, FAIR, Media Lens, DropSite News, Status Coup News, Responsible Statecraft, The Lever, Sludge, OpenSecrets, The Nation, In These Times, CounterPunch, WSWS, Truthdig, The Progressive, People's World, Bellingcat, ProPublica, The Markup, Reveal, ICIJ, Documented NY, Haaretz (English), +972 Magazine, Racket News.
        (These are reader-supported, nonprofit, or independently owned with documented editorial independence).
        
        Article Title: ${currentArticle.title}
        Source: ${currentArticle.source}
        Author: ${currentArticle.creator}
        
        Article Content:
        ${text.substring(0, 15000)} // Limit to avoid token issues
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              bias: {
                type: Type.OBJECT,
                properties: {
                  score: { type: Type.NUMBER, description: "0-100, where 0 is extremely left, 50 is center, 100 is extremely right" },
                  direction: { type: Type.STRING, description: "Left, Center, Right, or Unknown" },
                  description: { type: Type.STRING, description: "Detailed explanation of the bias found in the text." },
                  citations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Direct quotes from the article demonstrating this bias." }
                },
                required: ["score", "direction", "description", "citations"]
              },
              aiProbability: {
                type: Type.OBJECT,
                properties: {
                  score: { type: Type.NUMBER, description: "0-100 probability that this was written by AI" },
                  description: { type: Type.STRING, description: "Explanation of why it might be AI-generated or human-written." },
                  citations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Direct quotes from the article showing AI or human linguistic patterns." }
                },
                required: ["score", "description", "citations"]
              },
              propaganda: {
                type: Type.OBJECT,
                properties: {
                  detected: { type: Type.BOOLEAN },
                  techniques: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of specific propaganda techniques used." },
                  description: { type: Type.STRING, description: "Detailed breakdown of how these techniques are employed." },
                  citations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Direct quotes from the article demonstrating these techniques." }
                },
                required: ["detected", "techniques", "description", "citations"]
              },
              moneyTrail: {
                type: Type.OBJECT,
                properties: {
                  ownership: { type: Type.STRING, description: "Who owns this publication?" },
                  funding: { type: Type.STRING, description: "How is this publication funded?" },
                  conflictsOfInterest: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List any potential conflicts of interest." }
                },
                required: ["ownership", "funding", "conflictsOfInterest"]
              },
              truthScore: { type: Type.NUMBER, description: "0-100 overall assessment of factual reliability." },
              summary: { type: Type.STRING, description: "A hard-hitting, 2-3 sentence summary of what the article is ACTUALLY trying to do." }
            },
            required: ["bias", "aiProbability", "propaganda", "moneyTrail", "truthScore", "summary"]
          }
        }
      });

      const resultText = response.text;
      if (!resultText) throw new Error("Received empty response from AI model.");
      
      const parsedResult = JSON.parse(resultText) as AnalysisResult;
      setAnalysisResult(parsedResult);
      setAnalysisCount(prev => prev + 1);
      
    } catch (err: any) {
      console.error("Analysis error:", err);
      setAnalysisError(`Analysis failed: ${err.message}. This can happen if the site blocks scraping or the AI model encounters an error.`);
    } finally {
      setAnalyzing(false);
    }
  };

  const filteredArticles = articles.filter(a => filter === 'All' || a.sourceType === filter);

  const downloadPDF = () => {
    if (!selectedArticle || !analysisResult) return;
    
    const doc = new jsPDF();
    const margin = 15;
    let y = margin;
    const pageWidth = doc.internal.pageSize.width;
    const maxLineWidth = pageWidth - margin * 2;
    
    const addText = (text: string, fontSize: number, isBold: boolean = false, color: number[] = [0, 0, 0]) => {
      doc.setFontSize(fontSize);
      doc.setFont("helvetica", isBold ? "bold" : "normal");
      doc.setTextColor(color[0], color[1], color[2]);
      const lines = doc.splitTextToSize(text, maxLineWidth);
      
      if (y + lines.length * (fontSize * 0.4) > doc.internal.pageSize.height - margin) {
        doc.addPage();
        y = margin;
      }
      
      doc.text(lines, margin, y);
      y += lines.length * (fontSize * 0.4) + 5;
    };

    addText("InFauxMeter - Forensic Analysis Report", 20, true, [16, 185, 129]);
    y += 5;
    addText(`Article: ${selectedArticle.title}`, 14, true);
    addText(`Source: ${selectedArticle.source} | Published: ${new Date(selectedArticle.pubDate).toLocaleDateString()}`, 10, false, [100, 100, 100]);
    y += 5;
    
    addText("Executive Summary", 14, true);
    addText(analysisResult.summary, 11);
    y += 5;
    
    addText(`Truth Score: ${analysisResult.truthScore}/100`, 14, true);
    y += 5;
    
    addText("Bias Analysis", 14, true);
    addText(`Direction: ${analysisResult.bias.direction} (Score: ${analysisResult.bias.score})`, 11, true);
    addText(analysisResult.bias.description, 11);
    if (analysisResult.bias.citations.length > 0) {
      addText("Citations:", 11, true);
      analysisResult.bias.citations.forEach(c => addText(`"${c}"`, 10, false, [100, 100, 100]));
    }
    y += 5;
    
    addText("Propaganda Detection", 14, true);
    if (analysisResult.propaganda.detected) {
      addText(`Techniques: ${analysisResult.propaganda.techniques.join(', ')}`, 11, true);
      addText(analysisResult.propaganda.description, 11);
      if (analysisResult.propaganda.citations.length > 0) {
        addText("Citations:", 11, true);
        analysisResult.propaganda.citations.forEach(c => addText(`"${c}"`, 10, false, [100, 100, 100]));
      }
    } else {
      addText("No significant propaganda detected.", 11);
    }
    y += 5;
    
    addText("AI Authorship Probability", 14, true);
    addText(`Probability: ${analysisResult.aiProbability.score}%`, 11, true);
    addText(analysisResult.aiProbability.description, 11);
    if (analysisResult.aiProbability.citations.length > 0) {
      addText("Citations:", 11, true);
      analysisResult.aiProbability.citations.forEach(c => addText(`"${c}"`, 10, false, [100, 100, 100]));
    }
    y += 5;
    
    addText("Follow The Money", 14, true);
    addText(`Ownership: ${analysisResult.moneyTrail.ownership}`, 11);
    addText(`Funding: ${analysisResult.moneyTrail.funding}`, 11);
    if (analysisResult.moneyTrail.conflictsOfInterest.length > 0) {
      addText(`Conflicts of Interest: ${analysisResult.moneyTrail.conflictsOfInterest.join(', ')}`, 11);
    }
    
    doc.save(`InFauxMeter_Report_${selectedArticle.id}.pdf`);
  };

  const handleShare = () => {
    if (!selectedArticle || !analysisResult) return;
    const text = `InFauxMeter Analysis: ${selectedArticle.title}\nTruth Score: ${analysisResult.truthScore}/100\nBias: ${analysisResult.bias.direction}\nSummary: ${analysisResult.summary}\n\nRead original: ${selectedArticle.link}`;
    if (navigator.share) {
      navigator.share({
        title: 'InFauxMeter Analysis',
        text: text,
        url: selectedArticle.link,
      }).catch(console.error);
    } else {
      const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
      window.open(twitterUrl, '_blank');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800 p-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                <EyeOff className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold tracking-tight text-zinc-100">InFaux<span className="text-emerald-400">Meter</span></h1>
                  {isPremium && (
                    <span className="px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider rounded">PRO</span>
                  )}
                </div>
                <p className="text-xs text-zinc-400 font-mono hidden sm:block">Unveil the narrative. Follow the money.</p>
              </div>
            </div>
            <button 
              onClick={() => setShowResources(true)}
              className="sm:hidden p-2 text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 rounded-lg transition-colors border border-zinc-800"
              aria-label="Media Database"
            >
              <BookOpen className="w-5 h-5" />
            </button>
          </div>
          
          <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
            <div className="flex items-center gap-2 bg-zinc-900 p-1 rounded-lg border border-zinc-800 overflow-x-auto hide-scrollbar">
              {['All', 'Mainstream', 'Alternative'].map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f as any)}
                  className={`px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all whitespace-nowrap ${
                    filter === f 
                      ? 'bg-zinc-800 text-emerald-400 shadow-sm' 
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <button 
              onClick={() => setShowResources(true)}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 rounded-lg transition-colors border border-zinc-800"
            >
              <BookOpen className="w-4 h-4" />
              <span>Media Database</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: News Feed */}
        <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-4 h-[calc(100vh-8rem)] overflow-y-auto pr-2 custom-scrollbar">
          
          <form onSubmit={handleCustomScan} className="flex gap-2 bg-zinc-900/50 p-3 rounded-xl border border-zinc-800 shrink-0">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <LinkIcon className="w-4 h-4 text-zinc-500" />
              </div>
              <input
                type="url"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="Paste article URL to scan..."
                className="block w-full pl-9 pr-3 py-2 border border-zinc-700 rounded-lg leading-5 bg-zinc-950 text-zinc-300 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm transition-colors"
                required
              />
            </div>
            <button
              type="submit"
              disabled={!customUrl || analyzing}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
            >
              Scan
            </button>
          </form>

          <div className="flex justify-between items-center mb-2 shrink-0">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-zinc-400" />
              Live Feed
            </h2>
            <button 
              onClick={fetchNews} 
              disabled={loading}
              className={`p-2 text-zinc-400 hover:text-emerald-400 hover:bg-emerald-400/10 rounded-full transition-colors disabled:opacity-50`}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          {loading && !error ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-500 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-500/50" />
              <p className="text-sm font-mono">Aggregating sources...</p>
            </div>
          ) : (
            <AnimatePresence>
              {filteredArticles.map((article, idx) => (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  key={article.id}
                  onClick={() => setSelectedArticle(article)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    selectedArticle?.id === article.id
                      ? 'bg-zinc-800/80 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
                      : 'bg-zinc-900/50 border-zinc-800 hover:bg-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex flex-wrap justify-between items-start mb-2 gap-2">
                    <div className="flex flex-wrap gap-2">
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                        article.sourceType === 'Mainstream' 
                          ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' 
                          : 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                      }`}>
                        {article.source}
                      </span>
                      {article.sourceBias && (
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                          article.sourceBias === 'Left' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                          article.sourceBias === 'Right' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                          'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        }`}>
                          {article.sourceBias}
                        </span>
                      )}
                      {article.sourceCredibility && (
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                          article.sourceCredibility === 'High' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                          article.sourceCredibility === 'Low' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                          'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                        }`}>
                          {article.sourceCredibility} Cred
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-zinc-500 whitespace-nowrap">
                      {new Date(article.pubDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <h3 className="font-medium text-zinc-200 leading-snug mb-2 line-clamp-3">{article.title}</h3>
                  <p className="text-sm text-zinc-500 line-clamp-2">{article.contentSnippet}</p>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Right Column: Analysis Panel */}
        <div className="lg:col-span-7 xl:col-span-8">
          {!selectedArticle ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-zinc-800 rounded-2xl bg-zinc-900/20">
              <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mb-4 border border-zinc-800">
                <Search className="w-8 h-8 text-zinc-600" />
              </div>
              <h3 className="text-xl font-medium text-zinc-300 mb-2">Select or scan an article</h3>
              <p className="text-zinc-500 max-w-md">
                Click on any news item from the feed or paste a custom link to run a deep forensic analysis on bias, AI generation, propaganda, and follow the money trail.
              </p>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col h-full">
              {/* Article Header */}
              <div className="p-6 border-b border-zinc-800 bg-zinc-900/50">
                <div className="flex justify-between items-start gap-4 mb-4">
                  <h2 className="text-2xl font-bold text-zinc-100 leading-tight">{selectedArticle.title}</h2>
                  <div className="flex gap-2 shrink-0">
                    {analysisResult && (
                      <>
                        <button 
                          onClick={downloadPDF}
                          className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-emerald-400 transition-colors"
                          title="Download PDF Report"
                        >
                          <Download className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={handleShare}
                          className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-blue-400 transition-colors"
                          title="Share to Social Media"
                        >
                          <Share2 className="w-5 h-5" />
                        </button>
                      </>
                    )}
                    <a 
                      href={selectedArticle.link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors"
                      title="Read original article"
                    >
                      <ExternalLink className="w-5 h-5" />
                    </a>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-sm text-zinc-400 font-mono">
                  <span className="flex items-center gap-1.5">
                    <Newspaper className="w-4 h-4" /> {selectedArticle.source}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Info className="w-4 h-4" /> {selectedArticle.creator || 'Unknown Author'}
                  </span>
                </div>
              </div>

              {/* Analysis Action Area */}
              <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
                {!analysisResult && !analyzing && !analysisError && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <ShieldAlert className="w-16 h-16 text-emerald-500/50 mb-6" />
                    <h3 className="text-xl font-medium mb-2">Ready for Forensic Analysis</h3>
                    <p className="text-zinc-400 mb-8 max-w-lg">
                      Our AI will scrape the full article content, analyze it for bias, detect potential AI authorship, identify propaganda techniques, and trace the publisher's funding and ownership.
                    </p>
                    <button
                      onClick={() => analyzeArticle(selectedArticle)}
                      className="px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] transition-all flex items-center gap-3 group"
                    >
                      <Search className="w-5 h-5 group-hover:scale-110 transition-transform" />
                      Unveil The Truth & Follow The Money
                    </button>
                    <p className="mt-6 text-xs text-zinc-500 max-w-sm">
                      Note: Some websites block automated scraping. If analysis fails, please try a different news story.
                    </p>
                  </div>
                )}

                {analyzing && (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="relative w-24 h-24 mb-8">
                      <div className="absolute inset-0 border-4 border-zinc-800 rounded-full"></div>
                      <div className="absolute inset-0 border-4 border-emerald-500 rounded-full border-t-transparent animate-spin"></div>
                      <ShieldAlert className="absolute inset-0 m-auto w-8 h-8 text-emerald-500 animate-pulse" />
                    </div>
                    <h3 className="text-xl font-medium mb-2 animate-pulse">Running Forensic Analysis...</h3>
                    <div className="text-sm text-zinc-500 font-mono space-y-2 mt-4 text-left bg-zinc-950 p-4 rounded-lg border border-zinc-800 inline-block">
                      <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500" /> Scraping article content...</p>
                      <p className="flex items-center gap-2"><Loader2 className="w-4 h-4 text-emerald-500 animate-spin" /> Analyzing linguistic patterns...</p>
                      <p className="flex items-center gap-2"><Loader2 className="w-4 h-4 text-emerald-500 animate-spin" /> Cross-referencing ownership databases...</p>
                      <p className="flex items-center gap-2"><Loader2 className="w-4 h-4 text-emerald-500 animate-spin" /> Detecting propaganda techniques...</p>
                    </div>
                  </div>
                )}

                {analysisError && (
                  <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 flex flex-col items-center text-center gap-4">
                    <AlertTriangle className="w-12 h-12 text-red-500" />
                    <div>
                      <h3 className="text-lg font-bold mb-2">Analysis Failed</h3>
                      <p className="text-sm">{analysisError}</p>
                    </div>
                    <button
                      onClick={() => analyzeArticle(selectedArticle)}
                      className="px-6 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg transition-colors mt-2"
                    >
                      Retry Analysis
                    </button>
                  </div>
                )}

                {analysisResult && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6 selectable-text"
                  >
                    {/* Top Stats Row */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Truth Score */}
                      <div className="bg-zinc-950 border border-zinc-800 p-5 rounded-xl flex flex-col items-center justify-center text-center relative overflow-hidden">
                        <div className={`absolute top-0 left-0 w-full h-1 ${
                          analysisResult.truthScore > 70 ? 'bg-emerald-500' : 
                          analysisResult.truthScore > 40 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}></div>
                        <span className="text-xs text-zinc-500 font-mono uppercase tracking-wider mb-2">Truth Score</span>
                        <div className="text-4xl font-bold font-mono flex items-baseline gap-1">
                          <span className={
                            analysisResult.truthScore > 70 ? 'text-emerald-400' : 
                            analysisResult.truthScore > 40 ? 'text-yellow-400' : 'text-red-400'
                          }>{analysisResult.truthScore}</span>
                          <span className="text-lg text-zinc-600">/100</span>
                        </div>
                      </div>

                      {/* AI Probability */}
                      <div className="bg-zinc-950 border border-zinc-800 p-5 rounded-xl flex flex-col items-center justify-center text-center relative overflow-hidden">
                        <div className={`absolute top-0 left-0 w-full h-1 ${
                          analysisResult.aiProbability.score > 70 ? 'bg-red-500' : 
                          analysisResult.aiProbability.score > 30 ? 'bg-yellow-500' : 'bg-emerald-500'
                        }`}></div>
                        <span className="text-xs text-zinc-500 font-mono uppercase tracking-wider mb-2 flex items-center gap-1">
                          <Cpu className="w-3 h-3" /> AI Generated
                        </span>
                        <div className="text-4xl font-bold font-mono flex items-baseline gap-1">
                          <span className={
                            analysisResult.aiProbability.score > 70 ? 'text-red-400' : 
                            analysisResult.aiProbability.score > 30 ? 'text-yellow-400' : 'text-emerald-400'
                          }>{analysisResult.aiProbability.score}</span>
                          <span className="text-lg text-zinc-600">%</span>
                        </div>
                      </div>

                      {/* Bias Direction */}
                      <div className="bg-zinc-950 border border-zinc-800 p-5 rounded-xl flex flex-col items-center justify-center text-center relative overflow-hidden">
                        <div className={`absolute top-0 left-0 w-full h-1 ${
                          analysisResult.bias.direction === 'Center' ? 'bg-emerald-500' : 
                          analysisResult.bias.direction === 'Left' ? 'bg-blue-500' : 
                          analysisResult.bias.direction === 'Right' ? 'bg-red-500' : 'bg-zinc-500'
                        }`}></div>
                        <span className="text-xs text-zinc-500 font-mono uppercase tracking-wider mb-2">Political Bias</span>
                        <div className={`text-2xl font-bold ${
                          analysisResult.bias.direction === 'Center' ? 'text-emerald-400' : 
                          analysisResult.bias.direction === 'Left' ? 'text-blue-400' : 
                          analysisResult.bias.direction === 'Right' ? 'text-red-400' : 'text-zinc-400'
                        }`}>
                          {analysisResult.bias.direction}
                        </div>
                        <div className="w-full bg-zinc-800 h-1.5 rounded-full mt-3 overflow-hidden">
                          <div 
                            className={`h-full ${
                              analysisResult.bias.direction === 'Left' ? 'bg-blue-500' : 
                              analysisResult.bias.direction === 'Right' ? 'bg-red-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${analysisResult.bias.direction === 'Center' ? 100 : analysisResult.bias.score}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    {/* Executive Summary */}
                    <div className="bg-emerald-500/10 border border-emerald-500/20 p-5 rounded-xl">
                      <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4" /> The Real Narrative
                      </h3>
                      <p className="text-zinc-200 leading-relaxed">{analysisResult.summary}</p>
                    </div>

                    {/* Money Trail */}
                    <div className="bg-zinc-950 border border-zinc-800 p-6 rounded-xl">
                      <h3 className="text-lg font-bold text-zinc-100 mb-4 flex items-center gap-2 border-b border-zinc-800 pb-3">
                        <DollarSign className="w-5 h-5 text-yellow-500" /> Follow The Money
                      </h3>
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1">Ownership</h4>
                          <p className="text-zinc-300 text-sm">{analysisResult.moneyTrail.ownership}</p>
                        </div>
                        <div>
                          <h4 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1">Funding Sources</h4>
                          <p className="text-zinc-300 text-sm">{analysisResult.moneyTrail.funding}</p>
                        </div>
                        {analysisResult.moneyTrail.conflictsOfInterest.length > 0 && (
                          <div>
                            <h4 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-2">Conflicts of Interest</h4>
                            <ul className="space-y-2">
                              {analysisResult.moneyTrail.conflictsOfInterest.map((conflict, i) => (
                                <li key={i} className="flex items-start gap-2 text-sm text-zinc-300 bg-zinc-900 p-2 rounded border border-zinc-800">
                                  <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                                  <span>{conflict}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Propaganda & Bias Details */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-zinc-950 border border-zinc-800 p-5 rounded-xl">
                        <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <AlertTriangle className={`w-4 h-4 ${analysisResult.propaganda.detected ? 'text-red-500' : 'text-emerald-500'}`} /> 
                          Propaganda Analysis
                        </h3>
                        <p className="text-sm text-zinc-400 mb-4">{analysisResult.propaganda.description}</p>
                        {analysisResult.propaganda.techniques.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-4">
                            {analysisResult.propaganda.techniques.map((tech, i) => (
                              <span key={i} className="px-2 py-1 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-md">
                                {tech}
                              </span>
                            ))}
                          </div>
                        )}
                        {analysisResult.propaganda.citations.length > 0 && (
                          <div className="mt-4 space-y-2">
                            <h4 className="text-xs font-mono text-zinc-500 uppercase tracking-wider">Evidence from Text</h4>
                            {analysisResult.propaganda.citations.map((citation, i) => (
                              <div key={i} className="flex gap-2 text-sm text-zinc-400 bg-zinc-900 p-3 rounded-lg border border-zinc-800/50">
                                <Quote className="w-4 h-4 text-zinc-600 shrink-0 mt-0.5" />
                                <span className="italic">"{citation}"</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="bg-zinc-950 border border-zinc-800 p-5 rounded-xl flex flex-col">
                        <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <Info className="w-4 h-4 text-blue-500" /> 
                          Bias Breakdown
                        </h3>
                        <p className="text-sm text-zinc-400 mb-4">{analysisResult.bias.description}</p>
                        {analysisResult.bias.citations.length > 0 && (
                          <div className="mb-6 space-y-2">
                            <h4 className="text-xs font-mono text-zinc-500 uppercase tracking-wider">Evidence from Text</h4>
                            {analysisResult.bias.citations.map((citation, i) => (
                              <div key={i} className="flex gap-2 text-sm text-zinc-400 bg-zinc-900 p-3 rounded-lg border border-zinc-800/50">
                                <Quote className="w-4 h-4 text-zinc-600 shrink-0 mt-0.5" />
                                <span className="italic">"{citation}"</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="mt-auto pt-4 border-t border-zinc-800/50">
                          <h4 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-2">AI Authorship Analysis</h4>
                          <p className="text-sm text-zinc-400 mb-3">{analysisResult.aiProbability.description}</p>
                          {analysisResult.aiProbability.citations.length > 0 && (
                            <div className="space-y-2">
                              {analysisResult.aiProbability.citations.map((citation, i) => (
                                <div key={i} className="flex gap-2 text-sm text-zinc-400 bg-zinc-900 p-3 rounded-lg border border-zinc-800/50">
                                  <Quote className="w-4 h-4 text-zinc-600 shrink-0 mt-0.5" />
                                  <span className="italic">"{citation}"</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                  </motion.div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
      
      {/* Footer */}
      <footer className="border-t border-zinc-800 bg-zinc-950 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-zinc-500">
          <div>
            &copy; {new Date().getFullYear()} <a href="https://mediamultitool.com" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:text-emerald-400 transition-colors">Media Multi-Tool</a>. All rights reserved.
          </div>
          <div>
            <a 
              href="https://buymeacoffee.com/mediamultitool" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-full text-zinc-300 hover:text-emerald-400 transition-all"
            >
              <span className="text-yellow-500">☕</span> Buy Me a Coffee
            </a>
          </div>
        </div>
      </footer>
      
      {/* Global styles for custom scrollbar */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(24, 24, 27, 0.5);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(63, 63, 70, 0.8);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(82, 82, 91, 1);
        }
      `}} />

      {/* Resources Modal */}
      <AnimatePresence>
        {showResources && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[90vh] shadow-2xl relative flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between p-6 border-b border-zinc-800 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                    <BookOpen className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-zinc-100">Media Ownership & Credibility Database</h2>
                    <p className="text-sm text-zinc-400">Reference guide for InFauxMeter's forensic analysis</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowResources(false)}
                  className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-full transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
              
              <div className="p-6 overflow-y-auto custom-scrollbar flex-1 text-sm text-zinc-300 space-y-8 selectable-text">
                
                <section>
                  <h3 className="text-lg font-bold text-red-400 mb-4 flex items-center gap-2 pb-2 border-b border-red-500/20">
                    <AlertTriangle className="w-5 h-5" />
                    LIST 1: CAPTURED / COMPROMISED / MAINSTREAM / LEGACY MEDIA
                  </h3>
                  <div className="space-y-4 mb-6">
                    <p className="text-zinc-300 font-medium leading-relaxed">
                      There are two parallel information realities operating in America right now. One is the mainstream media ecosystem, a consolidated network of corporate outlets owned by billionaires, private equity firms, and publicly traded conglomerates with deep financial ties to Wall Street, the defense industry, and foreign policy interests. The other is real journalism, independent, reader-funded, and unbeholden to the donor class or the advertisers who keep the lights on at the big networks.
                    </p>
                    <p className="text-zinc-300 font-medium leading-relaxed">
                      The mainstream outlets aren't lying to you every minute of every day. They still cover car accidents, weather events, sports scores, and celebrity gossip accurately enough. But those are stories that don't threaten anyone's money or power. The moment a story touches foreign policy, military spending, political lobbying, or the interests of their owners, the framing shifts, the context disappears, and the narrative gets managed. That's not conspiracy. That's just how institutional self-interest works.
                    </p>
                  </div>
                  <p className="mb-4 text-zinc-400 italic">Based on ownership data (Harvard Future of Media Index), AIPAC donor records (OpenSecrets, TrackAIPAC), and publicly documented editorial positions.</p>
                  
                  <div className="space-y-4">
                    <p><strong>CNN</strong> — Warner Bros. Discovery. AT&T/Elliott Management background. Consistently frames Israeli military operations favorably. Editorial capture well-documented.</p>
                    <p><strong>MSNBC</strong> — Comcast/NBCUniversal. Brian Roberts family control. Fired/suppressed multiple Palestinian-sympathetic anchors (Mehdi Hasan, etc.)</p>
                    <p><strong>NBC News</strong> — Same Comcast ownership. Roberts family super-voting shares.</p>
                    <p><strong>ABC News</strong> — Walt Disney. Bob Iger (Chairman) is a vocal Zionist donor and Israel advocate, publicly and financially.</p>
                    <p><strong>CBS News / 60 Minutes</strong> — ViacomCBS. Shari Redstone (Sumner Redstone's daughter) — documented pro-Israel political giving.</p>
                    <p><strong>Fox News</strong> — Rupert Murdoch/News Corp. Murdoch is a documented Israel hawk; Fox is unwaveringly pro-Israel editorially.</p>
                    <p><strong>New York Times</strong> — Ochs-Sulzberger family, 125+ year Jewish Zionist ownership. Has been called out repeatedly for burying Palestinian civilian casualty coverage and framing Gaza coverage in Israeli government terms.</p>
                    <p><strong>Wall Street Journal</strong> — Rupert Murdoch/News Corp. Same as Fox.</p>
                    <p><strong>New York Post</strong> — Rupert Murdoch/News Corp.</p>
                    <p><strong>Washington Post</strong> — Jeff Bezos. Amazon has a $2B cloud contract with the Israeli military (Project Nimbus). Bezos editorially fired staff who signed a letter opposing Gaza coverage.</p>
                    <p><strong>Bloomberg</strong> — Michael Bloomberg, 88% owner. Major Democratic donor with deep ties to Israeli financial networks. Has donated to Israel advocacy organizations.</p>
                    <p><strong>US News & World Report</strong> — Mortimer Zuckerman, Canadian-American Zionist billionaire and former chairman of the Conference of Presidents of Major American Jewish Organizations.</p>
                    <p><strong>Newsweek</strong> — Features Alan Dershowitz as a regular columnist — Israel's most prominent American legal defender.</p>
                    <p><strong>The Atlantic</strong> — Laurene Powell Jobs/Emerson Collective. Heavy institutional donor overlap with pro-Israel causes.</p>
                    <p><strong>Business Insider / Axel Springer</strong> — KKR (Henry Kravis, George Roberts). Axel Springer requires employees to sign a loyalty pledge to Israel as a condition of employment — this is documented and non-contested.</p>
                    <p><strong>Politico</strong> — Axel Springer acquired Politico in 2021. Same Israel loyalty clause applies to all Springer properties.</p>
                    <p><strong>Univision</strong> — Haim Saban, Israeli-American billionaire, owned Univision. Donated $2M+ to AIPAC. Called himself a "one-issue guy" — that issue being Israel.</p>
                    <p><strong>The Hill</strong> — Jimmy Finkelstein, owner, longtime Republican donor with documented pro-Israel connections.</p>
                    <p><strong>Daily Beast</strong> — Barry Diller/IAC. Diller is a major Democratic donor with strong ties to Jewish institutional fundraising networks.</p>
                    <p><strong>Vox Media / New York Magazine / The Verge</strong> — NBCUniversal (Comcast) is the largest investor. See NBC/Comcast above.</p>
                    <p><strong>Slate</strong> — Graham Holdings. Donald Graham background includes Washington Post Company's historically pro-Israel editorial posture.</p>
                    <p><strong>Forbes</strong> — Steve Forbes (editor-in-chief). Consistent hawkish, pro-Israel editorial line throughout his tenure.</p>
                    <p><strong>Yahoo News</strong> — Apollo Global Management (private equity). Apollo's Leon Black has documented ties to Jeffrey Epstein AND to major Israel-linked financial networks.</p>
                    <p><strong>HuffPost / BuzzFeed</strong> — Jonah Peretti/NBCUniversal. Suppressed pro-Palestinian content multiple documented times during 2023-2024 Gaza coverage.</p>
                    <p><strong>NPR</strong> — Receives funding from numerous foundations with documented pro-Israel donor overlap. Fired Uri Berliner after he published an internal critique of editorial capture.</p>
                    <p><strong>PBS NewsHour</strong> — Donor list includes Howard & Abby Milstein Foundation, Judy and Peter Blum Kovler Foundation — documented pro-Israel philanthropic networks.</p>
                    <p><strong>The Guardian (US)</strong> — While UK-owned, US edition editorially softens Palestinian coverage relative to UK edition. Scott Trust funding includes overlap with liberal Zionist donor base.</p>
                    <p><strong>Reuters</strong> — Thomson family (Canada). Refinitiv sold to London Stock Exchange Group. Blackstone (Stephen Schwarzman — major AIPAC donor) held 55% of Reuters' revenue-generating arm for years.</p>
                    <p><strong>Associated Press</strong> — Google is largest funder. Google has Project Nimbus partnership with Israeli military alongside Amazon. Also receives funding from Chan-Zuckerberg Initiative.</p>
                    <p><strong>Washington Examiner</strong> — Philip Anschutz. Absorbed the Weekly Standard, which was the flagship neocon publication that cheerled the Iraq War.</p>
                    <p><strong>Daily Wire</strong> — Ben Shapiro (co-owner). Shapiro is arguably the most prominent media Zionist in America, openly and aggressively.</p>
                    <p><strong>Axios</strong> — NBCUniversal investor. Koch Industries is top advertiser. Emerson Collective (Laurene Powell Jobs) is an investor.</p>
                    <p><strong>The New Yorker / Vanity Fair / Wired</strong> — Newhouse family/Condé Nast. Samuel Newhouse Sr. built the empire; family has long ties to Jewish philanthropic and political networks.</p>
                    <p><strong>Advance Publications / NJ.com / Syracuse.com</strong> — Same Newhouse family umbrella.</p>
                    <p><strong>Time Magazine</strong> — Marc Benioff (Salesforce founder). Major Democratic donor with documented Jewish institutional giving, including to Israel-linked causes.</p>
                    <p><strong>Boston Globe / STAT News</strong> — John Henry. Red Sox owner. Henry is embedded in the same Boston/New York liberal donor class with documented pro-Israel institutional ties.</p>
                    <p><strong>Financial Times</strong> — Nikkei (Japanese). Less direct Israel connection, but FT editorially follows mainstream Western consensus framing on Gaza.</p>
                    <p><strong>Gannett / USA Today</strong> — Apollo Global Management debt holder (Leon Black connection). Editorial product follows AP/Reuters wire.</p>
                    <p><strong>McClatchy papers</strong> — Chatham Asset Management hedge fund. Barry Schwartz (partner) — Goldman Sachs background with deep Wall Street/Israel-linked financial network ties.</p>
                    <p><strong>LA Times</strong> — Patrick Soon-Shiong. Less direct, but embedded in Hollywood/entertainment donor class with strong Israeli government support culture.</p>
                    <p><strong>Chicago Tribune / Tribune papers</strong> — Alden Global Capital (32% stake). Hedge fund ownership — editorial gutting of local news is a feature, not a bug, of this model.</p>
                    <p><strong>Townhall / Salem Media</strong> — Christian Zionist ownership. Stuart Epperson and Ed Atsinger are doctrinaire Christian Zionists.</p>
                    <p><strong>Blaze Media</strong> — Glenn Beck is one of the most aggressive Christian Zionists in American media.</p>
                    <p><strong>Newsmax</strong> — Christopher Ruddy. Friend of Trump, Mar-a-Lago member. Editorially hawkish pro-Israel.</p>
                    <p><strong>OANN</strong> — Robert Herring Sr. Far-right, doctrinaire pro-Israel editorial line despite independent ownership.</p>
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-bold text-emerald-400 mb-4 flex items-center gap-2 pb-2 border-b border-emerald-500/20">
                    <CheckCircle className="w-5 h-5" />
                    LIST 2: INDEPENDENT OUTLETS — NO MAJOR CORPORATE/ZIONIST CAPTURE
                  </h3>
                  <p className="mb-4 text-zinc-400 italic">Reader-supported, nonprofit, or independently owned with documented editorial independence and no known AIPAC/Israel lobby donor connections.</p>
                  
                  <div className="space-y-6">
                    <div>
                      <h4 className="font-bold text-zinc-200 mb-2 uppercase text-xs tracking-wider">Investigative / Hard News</h4>
                      <div className="space-y-2">
                        <p><strong>The Intercept</strong> (theintercept.com) — Glenn Greenwald co-founded it. Reader-supported. Has broken major national security stories. Covers Gaza, AIPAC, and lobby influence directly.</p>
                        <p><strong>Consortium News</strong> (consortiumnews.com) — Founded by Robert Parry (AP/Newsweek veteran). Independent, reader-funded. Deep foreign policy and deep state coverage.</p>
                        <p><strong>MintPress News</strong> (mintpressnews.com) — Independent investigative. Has specifically covered Israeli intelligence operations, lobby influence, and Gaza extensively.</p>
                        <p><strong>The Grayzone</strong> (thegrayzone.com) — Max Blumenthal (son of Sidney Blumenthal). Aggressive investigative journalism on US foreign policy, NATO, and Israeli operations. No corporate funding.</p>
                        <p><strong>Mondoweiss</strong> (mondoweiss.net) — Specifically covers Israel/Palestine from a justice perspective. Nonprofit, reader-supported. One of the most rigorous outlets on this subject.</p>
                        <p><strong>Electronic Intifada</strong> (electronicintifada.net) — Independent Palestinian news and analysis. No state or corporate funding.</p>
                        <p><strong>Common Dreams</strong> (commondreams.org) — Nonprofit, no advertising, reader-supported. Covers AIPAC spending, Gaza, and progressive politics without corporate filter.</p>
                        <p><strong>Truthout</strong> (truthout.org) — Reader-supported nonprofit. No advertising. Covers US foreign policy and war without corporate constraint.</p>
                        <p><strong>ScheerPost</strong> (scheerpost.com) — Founded by Robert Scheer (LA Times veteran). Independent. Publishes Chris Hedges, Cornel West, and other dissident voices.</p>
                        <p><strong>Jacobin</strong> (jacobinmag.com) — Socialist publication, reader-supported. Has covered AIPAC donor networks and Gaza extensively without corporate pressure.</p>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-bold text-zinc-200 mb-2 uppercase text-xs tracking-wider">Independent Long-Form / Analysis</h4>
                      <div className="space-y-2">
                        <p><strong>Substack — Matt Taibbi</strong> (taibbi.substack.com) — Former Rolling Stone. Reader-supported only. Covers media capture, censorship, and foreign policy lobby influence directly.</p>
                        <p><strong>Substack — Glenn Greenwald</strong> (greenwald.substack.com) — Left the Intercept over editorial censorship. Fully reader-supported. Covers AIPAC, Israel, and press freedom.</p>
                        <p><strong>Substack — Aaron Maté</strong> — Covers Syria, Ukraine, Gaza, and US foreign policy. No corporate backing.</p>
                        <p><strong>Useful Idiots (podcast/Substack)</strong> — Katie Halper and Matt Taibbi. Katie Halper was fired from The Hill for covering Gaza. Fully independent now.</p>
                        <p><strong>Due Dissidence</strong> — Independent left media covering foreign policy without corporate filter.</p>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-bold text-zinc-200 mb-2 uppercase text-xs tracking-wider">International / Non-US Outlets With Strong Independence</h4>
                      <div className="space-y-2">
                        <p><strong>Al Jazeera English</strong> (aljazeera.com) — Qatar state-funded, which is a bias to note — but it is the only major English-language outlet with full-time Gaza correspondents on the ground and has provided coverage no Western outlet will touch. Has been targeted by Israel for shutdown.</p>
                        <p><strong>Middle East Eye</strong> (middleeasteye.net) — UK-based independent. No state funding. Covers Israeli operations, settler violence, and US policy thoroughly.</p>
                        <p><strong>Declassified UK</strong> (declassifieduk.org) — Covers UK/US military and intelligence with no corporate funding. Has broken stories on British arms sales to Israel.</p>
                        <p><strong>DAWN (Democracy for the Arab World Now)</strong> — Founded in memory of Jamal Khashoggi. Covers US policy in the Middle East. Independent nonprofit.</p>
                        <p><strong>The Real News Network</strong> (therealnews.com) — Nonprofit, no advertising, no government funding. Baltimore-based. Strong labor and foreign policy coverage.</p>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-bold text-zinc-200 mb-2 uppercase text-xs tracking-wider">Podcasts / Video Independent Media</h4>
                      <div className="space-y-2">
                        <p><strong>Breaking Points</strong> (Krystal Ball & Saagar Enjeti) — Left-right independent. Left corporate media (The Hill) specifically over editorial constraints. Reader/viewer funded.</p>
                        <p><strong>System Update (Glenn Greenwald)</strong> — Daily independent video journalism. No corporate backing.</p>
                        <p><strong>Democracy Now!</strong> (democracynow.org) — Amy Goodman. Nonprofit, listener-supported since 1996. Has covered Palestine continuously for 30 years without corporate interruption.</p>
                        <p><strong>Primo Nutmeg / Moderate Rebels</strong> — Independent foreign policy podcast. No corporate funding.</p>
                        <p><strong>The Jimmy Dore Show</strong> — Aggressively independent. Has covered AIPAC lobby and Gaza without filter. Fully audience-supported.</p>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-bold text-zinc-200 mb-2 uppercase text-xs tracking-wider">Watchdog / Accountability Media</h4>
                      <div className="space-y-2">
                        <p><strong>FAIR (Fairness & Accuracy in Reporting)</strong> (fair.org) — Media watchdog nonprofit. Documents pro-Israel bias in mainstream coverage with citations.</p>
                        <p><strong>Media Lens</strong> (medialens.org) — UK-based media criticism. Documents BBC and Guardian pro-establishment bias including on Israel/Palestine.</p>
                        <p><strong>DropSite News</strong> — New independent outlet from journalists who left mainstream media. Covers Gaza and national security.</p>
                        <p><strong>Status Coup News</strong> — Independent investigative, crowd-funded. Covers stories mainstream ignores.</p>
                        <p><strong>Responsible Statecraft</strong> (responsiblestatecraft.org) — Covers US military-industrial complex and foreign policy. Part of the Quincy Institute. No corporate advertising.</p>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-bold text-zinc-200 mb-2 uppercase text-xs tracking-wider">Regional / Specialty Independent</h4>
                      <div className="space-y-2">
                        <p><strong>The Lever</strong> (levernews.com) — Investigative nonprofit. Has published primary-source AIPAC donor documents. One of the most important outlets on money in politics.</p>
                        <p><strong>Sludge</strong> (readsludge.com) — Tracks dark money, AIPAC PAC spending, and political financing. Essential resource.</p>
                        <p><strong>OpenSecrets</strong> (opensecrets.org) — Nonprofit data journalism. Tracks all AIPAC and related PAC spending in documented form.</p>
                        <p><strong>The Nation</strong> (thenation.com) — America's oldest independent magazine. Reader-supported. Has covered Palestine, AIPAC, and foreign policy lobby for decades. Not perfect but editorially independent.</p>
                        <p><strong>In These Times</strong> (inthesetimes.com) — Nonprofit, reader-supported. Published the AIPAC donor investigation referenced above.</p>
                        <p><strong>CounterPunch</strong> (counterpunch.org) — Independent left. Publishes dissident voices including Jewish anti-Zionist writers. No advertising model.</p>
                        <p><strong>World Socialist Web Site</strong> (wsws.org) — Hard left, fully independent of all state and corporate funding. Covers US foreign policy and war.</p>
                        <p><strong>Truthdig</strong> — Robert Scheer's original outlet (now ScheerPost above, but archives remain valuable).</p>
                        <p><strong>The Progressive</strong> (progressive.org) — Wisconsin-based independent. Has covered Palestinian rights for decades.</p>
                        <p><strong>People's World</strong> — Labor-connected independent. No corporate ownership.</p>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-bold text-zinc-200 mb-2 uppercase text-xs tracking-wider">Additional Credible Independent Voices</h4>
                      <div className="space-y-2">
                        <p><strong>Bellingcat</strong> (bellingcat.com) — Open-source investigative journalism. Not always anti-establishment, but independently funded and rigorous on evidence.</p>
                        <p><strong>ProPublica</strong> (propublica.org) — Nonprofit investigative. Receives some foundation funding (note: Sandler Foundation, etc.) but editorial independence is strong and corrections culture is real.</p>
                        <p><strong>The Markup</strong> (themarkup.org) — Tech-focused nonprofit investigative. No advertising.</p>
                        <p><strong>Reveal (Center for Investigative Reporting)</strong> — Nonprofit, listener-supported. Covers national security and civil rights.</p>
                        <p><strong>ICIJorg (International Consortium of Investigative Journalists)</strong> — Panama Papers, Pandora Papers. No advertising.</p>
                        <p><strong>Documented NY</strong> — Corporate accountability journalism. No advertising model.</p>
                        <p><strong>Haaretz (English edition)</strong> — This may surprise you: Haaretz is an Israeli paper that the Israeli government has <em>boycotted and defunded</em> because it covers IDF war crimes and settler violence critically. It is arguably more honest on Gaza than any American mainstream outlet.</p>
                        <p><strong>+972 Magazine</strong> — Israeli-Palestinian independent journalism. Reader-funded. Broke the story on Israel's AI targeting system ("Lavender") used in Gaza assassinations.</p>
                        <p><strong>Drop Site News</strong> — New outlet from Ryan Grim and others who left mainstream media. Independent, subscription-based.</p>
                        <p><strong>Racket News (Matt Taibbi)</strong> — Full reader-supported platform covering censorship, media capture, and foreign policy lobby.</p>
                      </div>
                    </div>
                  </div>
                </section>
                
                <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700/50 mt-8">
                  <p className="text-xs text-zinc-400">
                    <strong>Note on using these lists:</strong> The independent outlets vary politically — some are left, some libertarian, some anti-war-right. What they share is no corporate ownership, no AIPAC donor money in their funding chain, and a track record of covering stories the mainstream won't touch. Cross-reference between several of them for the most complete picture.
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Paywall Modal */}
      <AnimatePresence>
        {showPaywall && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-blue-500"></div>
              
              <div className="flex justify-center mb-6 mt-4">
                <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center border border-emerald-500/20">
                  <Crown className="w-8 h-8 text-emerald-500" />
                </div>
              </div>
              
              <h2 className="text-2xl font-bold text-center mb-2">Unlock Unlimited Analysis</h2>
              <p className="text-zinc-400 text-center mb-6">
                You've used your 3 free forensic scans. Upgrade to Premium to continue uncovering the truth.
              </p>
              
              <div className="space-y-3 mb-8">
                <div className="flex items-center gap-3 text-sm text-zinc-300">
                  <Check className="w-5 h-5 text-emerald-500 shrink-0" />
                  <span>Unlimited AI Forensic Scans</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-zinc-300">
                  <Check className="w-5 h-5 text-emerald-500 shrink-0" />
                  <span>Deep Propaganda Detection</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-zinc-300">
                  <Check className="w-5 h-5 text-emerald-500 shrink-0" />
                  <span>Follow-The-Money Ownership Tracing</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-zinc-300">
                  <Check className="w-5 h-5 text-emerald-500 shrink-0" />
                  <span>PDF Report Exports</span>
                </div>
              </div>
              
              <button 
                onClick={() => {
                  if (window.AndroidBridge && window.AndroidBridge.showPaywall) {
                    // Trigger the native RevenueCat paywall
                    window.AndroidBridge.showPaywall();
                  } else {
                    // Fallback for testing in a regular browser
                    console.log("AndroidBridge not found. Mocking successful purchase.");
                    setIsPremium(true);
                    setShowPaywall(false);
                  }
                }}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-xl transition-colors flex items-center justify-center gap-2 mb-3"
              >
                <Lock className="w-4 h-4" /> Subscribe for $4.99/mo
              </button>
              
              <button 
                onClick={() => {
                  if (window.AndroidBridge && window.AndroidBridge.restorePurchases) {
                    window.AndroidBridge.restorePurchases();
                  } else {
                    console.log("AndroidBridge not found. Mocking restore.");
                    setIsPremium(true);
                    setShowPaywall(false);
                  }
                }}
                className="w-full py-3 text-emerald-500 hover:text-emerald-400 text-sm font-medium transition-colors mb-1"
              >
                Restore Purchases
              </button>

              <button 
                onClick={() => setShowPaywall(false)}
                className="w-full py-3 text-zinc-500 hover:text-zinc-300 text-sm font-medium transition-colors"
              >
                Maybe Later
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
