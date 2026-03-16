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
  Link as LinkIcon
} from 'lucide-react';

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
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
              <EyeOff className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-zinc-100">InFaux<span className="text-emerald-400">Meter</span></h1>
              <p className="text-xs text-zinc-400 font-mono">Unveil the narrative. Follow the money.</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
            {['All', 'Mainstream', 'Alternative'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f as any)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                  filter === f 
                    ? 'bg-zinc-800 text-emerald-400 shadow-sm' 
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                }`}
              >
                {f}
              </button>
            ))}
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
                    className="space-y-6"
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
    </div>
  );
}
