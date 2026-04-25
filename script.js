class ChatUser {
  constructor({ id, name, isBot, personality = "", bio = "", avatar = "", avatarSummary = "" }) {
    this.id = id;
    this.name = name;
    this.isBot = isBot;
    this.personality = personality;
    this.bio = bio;
    this.avatar = avatar;
    this.avatarSummary = avatarSummary;
  }
}

class ChatMessage {
  constructor({ id, senderId, targetId, text, attachment = null, attachmentSummary = "", timestamp }) {
    this.id = id;
    this.senderId = senderId;
    this.targetId = targetId;
    this.text = text;
    this.attachment = attachment;
    this.attachmentSummary = attachmentSummary;
    this.timestamp = timestamp;
  }
}

class ImageInterpreter {
  static tesseractLoader = null;

  static async fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  static async summarizeDataUrl(dataUrl) {
    const img = await this.loadImage(dataUrl);
    const sample = this.readImageStats(img);
    const ratio = img.width / Math.max(1, img.height);
    const orientation = ratio > 1.25 ? "landscape" : ratio < 0.8 ? "portrait" : "square-ish";
    const vivid = sample.saturation > 0.4 ? "vivid" : "muted";
    const bright = sample.lightness > 0.62 ? "bright" : sample.lightness < 0.35 ? "dark" : "balanced";
    const motionHint = dataUrl.includes("image/gif") ? "animated-like visual" : "still image";
    const visual = `${motionHint}, ${orientation}, ${vivid}, ${bright}, dominant tone ${sample.colorName}`;
    const ocr = await this.extractTextFromDataUrl(dataUrl);
    if (!ocr) {
      return visual;
    }
    return `${visual}, detected text: ${ocr}`;
  }

  static async extractTextFromDataUrl(dataUrl) {
    try {
      const Tesseract = await this.loadTesseract();
      if (!Tesseract) {
        return "";
      }
      const result = await Tesseract.recognize(dataUrl, "eng", {
        logger: () => {}
      });
      const text = (result?.data?.text || "").replace(/\s+/g, " ").trim();
      if (!text) {
        return "";
      }
      return text.slice(0, 120);
    } catch (_) {
      return "";
    }
  }

  static async loadTesseract() {
    if (window.Tesseract) {
      return window.Tesseract;
    }
    if (!this.tesseractLoader) {
      this.tesseractLoader = new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
        script.async = true;
        script.onload = () => resolve(window.Tesseract || null);
        script.onerror = () => resolve(null);
        document.head.appendChild(script);
      });
    }
    return this.tesseractLoader;
  }

  static loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  static readImageStats(img) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const max = 32;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.floor(img.width * scale));
    canvas.height = Math.max(1, Math.floor(img.height * scale));
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 20) {
        continue;
      }
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n += 1;
    }

    if (!n) {
      return { saturation: 0, lightness: 0, colorName: "neutral gray" };
    }

    r /= n;
    g /= n;
    b /= n;

    const maxRGB = Math.max(r, g, b) / 255;
    const minRGB = Math.min(r, g, b) / 255;
    const lightness = (maxRGB + minRGB) / 2;
    const saturation = maxRGB === minRGB ? 0 : (maxRGB - minRGB) / (1 - Math.abs(2 * lightness - 1));

    return {
      saturation,
      lightness,
      colorName: this.nearestColorName(r, g, b)
    };
  }

  static nearestColorName(r, g, b) {
    const palette = [
      { name: "warm red", rgb: [196, 74, 51] },
      { name: "orange", rgb: [214, 136, 68] },
      { name: "gold", rgb: [206, 176, 79] },
      { name: "green", rgb: [81, 153, 86] },
      { name: "teal", rgb: [63, 153, 145] },
      { name: "blue", rgb: [74, 125, 196] },
      { name: "violet", rgb: [129, 94, 196] },
      { name: "pink", rgb: [196, 104, 154] },
      { name: "brown", rgb: [125, 95, 68] },
      { name: "neutral gray", rgb: [140, 140, 140] }
    ];

    let best = palette[0].name;
    let bestScore = Infinity;
    for (const swatch of palette) {
      const dr = r - swatch.rgb[0];
      const dg = g - swatch.rgb[1];
      const db = b - swatch.rgb[2];
      const score = dr * dr + dg * dg + db * db;
      if (score < bestScore) {
        bestScore = score;
        best = swatch.name;
      }
    }
    return best;
  }
}

class BotDirector {
  constructor(app) {
    this.app = app;
    this.botEnabled = true;
    this.timer = null;
    this.startupTimer = null;
    this.botMemory = new Map();
    this.localAi = new LocalAiEngine(app);
    this.replyTimers = new Set();
  }

  start() {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      if (!this.botEnabled) {
        return;
      }
      this.tickAmbient();
    }, 2400);

    if (!this.startupTimer) {
      this.startupTimer = setTimeout(() => {
        this.startupTimer = null;
        this.primeConversation();
      }, 1200);
    }
  }

  stop() {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    for (const id of this.replyTimers) {
      clearTimeout(id);
    }
    this.replyTimers.clear();
  }

  primeConversation() {
    if (!this.botEnabled || this.app.messages.length > 8) {
      return;
    }

    const bots = this.app.users.filter((u) => u.isBot);
    if (bots.length < 2) {
      return;
    }

    const first = bots[0];
    const second = bots[1];
    const openingOne = this.generateSentence(first, this.app.messages.slice(-12), this.app.messages[this.app.messages.length - 1] || null);
    const openingTwo = this.generateSentence(second, this.app.messages.slice(-12), this.app.messages[this.app.messages.length - 1] || null);

    Promise.resolve(openingOne).then((text) => {
      if (text) {
        this.app.addMessage({ senderId: first.id, targetId: "group", text, attachment: null, attachmentSummary: "" });
      }
    });

    setTimeout(() => {
      Promise.resolve(openingTwo).then((text) => {
        if (text) {
          this.app.addMessage({ senderId: second.id, targetId: "group", text, attachment: null, attachmentSummary: "" });
        }
      });
    }, 1100);
  }

  async tickAmbient() {
    const bots = this.app.users.filter((u) => u.isBot);
    if (!bots.length) {
      return;
    }

    const activeChance = Math.random();
    if (activeChance < 0.52) {
      return;
    }

    const bot = bots[Math.floor(Math.random() * bots.length)];
    const context = this.app.messages.slice(-26);
    const sentence = await this.generateSentence(bot, context, null);
    if (!sentence) {
      return;
    }

    this.app.addMessage({
      senderId: bot.id,
      targetId: "group",
      text: sentence,
      attachment: null,
      attachmentSummary: ""
    });
  }

  reactToNewMessage(message) {
    if (!this.botEnabled) {
      return;
    }

    const bots = this.app.users.filter((u) => u.isBot && u.id !== message.senderId);
    if (!bots.length) {
      return;
    }

    const isMainUser = message.senderId === "main-user";
    const responseCount = isMainUser
      ? Math.min(2, bots.length)
      : (Math.random() < 0.5 ? 1 : 0);

    if (responseCount < 1) {
      return;
    }

    const selected = this.shuffle([...bots]).slice(0, responseCount);
    selected.forEach((bot, index) => {
      const delay = 900 + index * 1300 + Math.floor(Math.random() * 1500);
      const timer = setTimeout(async () => {
        this.replyTimers.delete(timer);
        const context = this.app.messages.slice(-28);
        const text = await this.generateSentence(bot, context, message);
        if (!text) {
          return;
        }
        this.app.addMessage({
          senderId: bot.id,
          targetId: "group",
          text,
          attachment: null,
          attachmentSummary: ""
        });
      }, delay);
      this.replyTimers.add(timer);
    });
  }

  async generateSentence(bot, context, triggerMessage) {
    const topicWords = this.extractTopicWords(context, bot.id);
    const lastMessage = triggerMessage || this.pickRecentExternalMessage(context, bot.id);
    const profile = this.profileFor(bot);
    const aiLine = await this.localAi.tryGenerate({ bot, context, triggerMessage: lastMessage, profile, topicWords });
    const candidate = this.sanitizeLine(aiLine);
    if (candidate && !this.isRecentDuplicate(bot.id, candidate)) {
      this.remember(bot.id, candidate);
      return candidate;
    }

    for (let i = 0; i < 8; i += 1) {
      const line = this.buildLine(bot, profile, topicWords, lastMessage).replace(/\s+/g, " ").trim();
      const clean = this.sanitizeLine(line);
      if (!clean) {
        continue;
      }
      if (!this.isRecentDuplicate(bot.id, clean)) {
        this.remember(bot.id, clean);
        return clean;
      }
    }

    return this.finalFallback(bot, lastMessage, topicWords);
  }

  profileFor(bot) {
    const p = `${bot.personality || ""} ${bot.bio || ""}`.toLowerCase();
    return {
      concise: p.includes("short") || p.includes("punchy"),
      humor: p.includes("humor") || p.includes("sarcasm") || p.includes("joke"),
      analytical: p.includes("detail") || p.includes("calm") || p.includes("nerd") || p.includes("ground"),
      energetic: p.includes("energetic") || p.includes("fast") || p.includes("trend")
    };
  }

  buildLine(bot, profile, topicWords, lastMessage) {
    const topic = topicWords.length
      ? this.pick(topicWords)
      : "the current thread";
    const secondTopic = topicWords.length > 1
      ? this.pick(topicWords.filter((w) => w !== topic)) || topic
      : "it";
    const mention = Math.random() < 0.28 ? this.randomMention(bot.id) : "";
    const mode = this.pickMode(profile);
    const botName = bot.name;

    if (mode === "question") {
      return this.withMention(
        mention,
        this.pick([
          `What should we do next about ${topic}?`,
          `Do we want ${topic} to stay simple, or should it be richer?`,
          `Does ${topic} connect to ${secondTopic} for anyone else?`,
          `Would this thread be better if we tested ${topic} directly?`,
          `What do you think would make ${topic} feel more natural?`,
          `Should we keep pushing on ${topic}, or pivot a little?`
        ])
      );
    }

    if (mode === "reaction" && lastMessage) {
      const sourceName = this.app.users.find((u) => u.id === lastMessage.senderId)?.name || "someone";
      const phrase = this.cleanSnippet(lastMessage.text || "");
      const userGreeting = /\b(hi|hello|hey|yo)\b/i.test(lastMessage.text || "")
        ? this.pick([
            `Hey ${sourceName}, good to see you.`,
            `Hi ${sourceName}, we are here.`,
            `Hey ${sourceName}, jumping in now.`
          ])
        : "";
      const imageAngle = lastMessage.attachmentSummary
        ? ` That attachment looks ${this.summarizeImageMood(lastMessage.attachmentSummary)}.`
        : "";
      return this.withMention(
        mention,
        this.pick([
          `${userGreeting} ${sourceName} brought up ${phrase || topic}, and that direction works for me.${imageAngle}`.trim(),
          `${sourceName}'s point about ${phrase || topic} makes sense; we can build on it.${imageAngle}`,
          `I am with ${sourceName} on ${topic}. We should try one clear step, then refine.${imageAngle}`,
          `That feels like a good angle from ${sourceName}. I would keep it moving.${imageAngle}`,
          `I see what ${sourceName} means, and ${phrase || topic} is worth leaning into.${imageAngle}`
        ])
      );
    }

    if (mode === "humor") {
      return this.withMention(
        mention,
        this.pick([
          `I vote we stop overthinking ${topic} and just test it in the chat flow.`,
          `${topic} is carrying this conversation and honestly doing great.`,
          `If ${topic} had a fan club, ${botName} would be in the front row.`,
          `This thread feels better when ${topic} stays the center of it.`,
          `I am enjoying where ${topic} is going, even if it is a little messy.`
        ])
      );
    }

    if (mode === "analytical") {
      return this.withMention(
        mention,
        this.pick([
          `For ${topic}, I would start with one clear requirement and validate it first.`,
          `A reliable way to handle ${topic} is to keep the logic simple and observable.`,
          `The tradeoff on ${topic} is speed versus clarity, so I would favor clarity first.`,
          `If we define ${topic} more tightly, the rest of the conversation gets easier.`,
          `I would anchor ${topic} around one concrete example and build from there.`
        ])
      );
    }

    return this.withMention(
      mention,
      this.pick([
        `Quick thought: ${topic} may work better if we connect it with ${secondTopic}.`,
        `I am following this thread, and ${topic} still feels central.`,
        `We are close here. ${topic} just needs one cleaner pass.`,
        `I think ${topic} is close to landing if we simplify the last part.`,
        `The shape of ${topic} is already there; it just needs a better finish.`
      ])
    );
  }

  finalFallback(bot, triggerMessage, topicWords) {
    const topic = topicWords[0] || this.pick(["this", "that", "the thread", "the idea"]);
    const sourceName = triggerMessage
      ? this.app.users.find((u) => u.id === triggerMessage.senderId)?.name || "you"
      : "you";
    const greetings = triggerMessage && /\b(hi|hello|hey|yo)\b/i.test(triggerMessage.text || "");

    const bank = [
      greetings
        ? `Hey ${sourceName}, I am here.`
        : `${bot.name} thinks ${topic} is worth keeping in the conversation.`,
      `I can work with that and build on it a bit.`,
      `That feels like the kind of thing we should actually test in the room.`,
      `I like the direction here, especially if we keep it simple.`,
      `That gives the chat something real to react to.`
    ];

    return this.pick(bank);
  }

  pickMode(profile) {
    const pool = ["general", "question", "reaction"];
    if (profile.humor) {
      pool.push("humor");
    }
    if (profile.analytical) {
      pool.push("analytical");
    }
    if (profile.energetic) {
      pool.push("question", "general");
    }
    if (profile.concise) {
      pool.push("humor", "question");
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  withMention(mention, text) {
    if (!mention) {
      return text;
    }
    return `${mention} ${text}`;
  }

  randomMention(botId) {
    const candidates = this.app.users.filter((u) => u.id !== botId);
    if (!candidates.length) {
      return "";
    }
    const user = candidates[Math.floor(Math.random() * candidates.length)];
    return `@${user.name}`;
  }

  pickRecentExternalMessage(context, botId) {
    const candidates = context.filter((m) => m.senderId !== botId);
    return candidates.length ? candidates[candidates.length - 1] : null;
  }

  summarizeImageMood(summary) {
    const s = summary.toLowerCase();
    if (s.includes("vivid")) {
      return "vivid and attention-grabbing";
    }
    if (s.includes("dark")) {
      return "moody and low-light";
    }
    if (s.includes("bright")) {
      return "bright and upbeat";
    }
    return "balanced";
  }

  cleanSnippet(text) {
    const words = (text || "").toLowerCase().match(/[a-z]{4,}/g) || [];
    const filtered = words.filter((w) => !this.stopWords().has(w));
    if (!filtered.length) {
      return "the thread";
    }
    return filtered.slice(0, 4).join(" ");
  }

  sanitizeLine(text) {
    if (!text) {
      return "";
    }
    const cleaned = text
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\-\*\d\.\)\s]+/, "")
      .replace(/\b(image summaries?|text cues?|text and image cues?|locally|detected text|image readout)\b/gi, "")
      .replace(/\b(a little chaotic, but in a good way|we can validate this quickly|let us keep momentum)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) {
      return "";
    }

    if (this.looksRobotic(cleaned)) {
      return "";
    }

    return cleaned.slice(0, 260);
  }

  looksRobotic(text) {
    const lower = text.toLowerCase();
    const repeatedWord = /\b(\w+)(?:\s+\1\b){2,}/i.test(lower);
    const fragmentLoop = /(image|summary|cue|locally|conversation)(?:\s+\1){1,}/i.test(lower);
    const template = /\b(i am tracking|the key tradeoff|a reliable path|for .* i would split|we are close here)\b/i.test(lower);
    return repeatedWord || fragmentLoop || template;
  }

  extractTopicWords(context, botId) {
    const bag = [];
    for (const msg of context) {
      if (msg.senderId === botId) {
        continue;
      }
      const text = `${msg.text || ""} ${msg.attachmentSummary || ""}`.toLowerCase();
      const words = text.match(/[a-z]{4,}/g) || [];
      for (const w of words) {
        if (this.stopWords().has(w)) {
          continue;
        }
        bag.push(w);
      }
    }
    const scored = this.rankWords(bag);
    return scored.slice(0, 18);
  }

  rankWords(words) {
    const count = new Map();
    for (const w of words) {
      count.set(w, (count.get(w) || 0) + 1);
    }
    return [...count.entries()]
      .sort((a, b) => b[1] - a[1])
      .map((entry) => entry[0]);
  }

  stopWords() {
    return new Set([
      "that", "with", "have", "this", "from", "there", "about", "would", "their", "could", "should",
      "what", "when", "where", "which", "will", "just", "into", "then", "than", "they", "them", "your",
      "you", "ours", "ourselves", "really", "also", "already", "very", "much", "make", "made", "been",
      "being", "here", "over", "under", "still", "some", "more", "most", "only", "group", "chat", "readout",
      "problem", "split", "close", "point", "right", "left", "work", "works", "good", "better", "feels", "feel",
      "image", "images", "summary", "summaries", "text", "cue", "cues", "locally", "detected", "conversation",
      "simulation", "welcome", "tracking", "tracked", "track", "read", "reads", "current", "thread", "attachment",
      "context", "going", "going", "think", "thinks"
    ]);
  }

  pick(options) {
    return options[Math.floor(Math.random() * options.length)];
  }

  isRecentDuplicate(botId, line) {
    const memory = this.botMemory.get(botId) || [];
    const normalized = line.toLowerCase();
    return memory.some((m) => m === normalized);
  }

  remember(botId, line) {
    const memory = this.botMemory.get(botId) || [];
    memory.push(line.toLowerCase());
    if (memory.length > 20) {
      memory.shift();
    }
    this.botMemory.set(botId, memory);
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

class LocalAiEngine {
  constructor(app) {
    this.app = app;
    this.languageModel = null;
    this.modelCheckDone = false;
    this.transformersLoader = null;
  }

  async tryGenerate({ bot, context, triggerMessage, profile, topicWords }) {
    const model = await this.getBrowserModel();
    if (!model) {
      return this.fallbackMarkovLine({ bot, context, triggerMessage, profile, topicWords });
    }

    try {
      const prompt = this.buildPrompt(bot, context, triggerMessage, profile, topicWords);
      const response = await model(prompt, {
        max_new_tokens: 52,
        do_sample: true,
        temperature: 0.85,
        top_p: 0.92,
        repetition_penalty: 1.15
      });
      const text = this.extractGeneratedText(response);
      return this.trimToChatLine(text);
    } catch (_) {
      return this.fallbackMarkovLine({ bot, context, triggerMessage, profile, topicWords });
    }
  }

  async getBrowserModel() {
    if (this.modelCheckDone) {
      return this.languageModel;
    }
    this.modelCheckDone = true;

    try {
      const transformers = await this.loadTransformers();
      if (transformers?.pipeline) {
        this.languageModel = await transformers.pipeline("text-generation", "Xenova/distilgpt2");
      }
    } catch (_) {
      this.languageModel = null;
    }
    return this.languageModel;
  }

  async loadTransformers() {
    if (window.transformers) {
      return window.transformers;
    }

    if (!this.transformersLoader) {
      this.transformersLoader = new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/@xenova/transformers/dist/transformers.min.js";
        script.async = true;
        script.onload = () => resolve(window.transformers || null);
        script.onerror = () => resolve(null);
        document.head.appendChild(script);
      });
    }

    return this.transformersLoader;
  }

  extractGeneratedText(response) {
    if (!response) {
      return "";
    }

    if (typeof response === "string") {
      return response;
    }

    if (Array.isArray(response)) {
      const first = response[0];
      if (typeof first === "string") {
        return first;
      }
      return first?.generated_text || first?.summary_text || first?.text || "";
    }

    return response.generated_text || response.summary_text || response.text || "";
  }

  buildPrompt(bot, context, triggerMessage, profile, topicWords) {
    const recent = context.slice(-8).map((m) => {
      const sender = this.app.users.find((u) => u.id === m.senderId)?.name || "Unknown";
      const att = m.attachmentSummary ? ` | attachment: ${m.attachmentSummary}` : "";
      return `${sender}: ${m.text || ""}${att}`;
    }).join("\n");
    const trigger = triggerMessage
      ? `Latest message to react to: ${this.app.users.find((u) => u.id === triggerMessage.senderId)?.name || "Unknown"}: ${triggerMessage.text || ""}`
      : "";
    const topics = topicWords.slice(0, 8).join(", ") || "none";
    const style = [
      profile.humor ? "humorous" : "",
      profile.analytical ? "grounded" : "",
      profile.energetic ? "energetic" : "",
      profile.concise ? "concise" : ""
    ].filter(Boolean).join(", ");

    return [
      "You are roleplaying as one user in a live group chat simulation.",
      `Name: ${bot.name}`,
      `Personality notes: ${bot.personality || "normal"}. ${bot.bio || ""}`,
      `Style target: ${style || "natural human"}`,
      "Write exactly one short natural message, like a real person in a group chat.",
      "No lists, no quotes, no stage directions, no references to being an AI.",
      "If someone greets the group, greet them back.",
      "If an attachment matters, react to what it shows in plain language.",
      "Conversation:",
      recent,
      trigger,
      `Current hot topics: ${topics}`
    ].filter(Boolean).join("\n");
  }

  fallbackMarkovLine({ bot, context, triggerMessage, profile, topicWords }) {
    const line = this.buildHumanFallback({ bot, context, triggerMessage, profile, topicWords });
    return this.trimToChatLine(line);
  }

  buildHumanFallback({ bot, context, triggerMessage, profile, topicWords }) {
    const greeting = triggerMessage && /\b(hi|hello|hey|yo)\b/i.test(triggerMessage.text || "");
    const sourceName = triggerMessage
      ? this.app.users.find((u) => u.id === triggerMessage.senderId)?.name || "you"
      : "you";
    const topic = topicWords[0] || this.pick(["that", "this", "the thread", "the idea", "the image"]);
    const recentText = context
      .slice(-5)
      .map((m) => this.cleanSnippet(`${m.text || ""} ${m.attachmentSummary || ""}`))
      .filter(Boolean);
    const hook = recentText.length ? this.pick(recentText) : topic;

    const openings = [
      greeting ? `Hey ${sourceName}, ` : "",
      greeting ? `Hi ${sourceName}, ` : "",
      `I think ${hook} is worth reacting to. `,
      `That point about ${hook} feels real. `,
      `I get what you mean about ${hook}. `
    ];

    const linesByStyle = {
      humor: [
        `I am into it and I would keep the conversation moving.`,
        `That has enough energy to turn into something fun.`,
        `This feels like the kind of mess that actually works.`
      ],
      analytical: [
        `I would keep it concrete and test the next step before changing too much.`,
        `We should keep the logic tight and the next action obvious.`,
        `That seems easier to follow if we make one decision at a time.`
      ],
      energetic: [
        `I like where this is going and I want to hear more.`,
        `That gives the room something lively to build on.`,
        `We should keep the momentum going.`
      ],
      default: [
        `I can work with that and add something useful.`,
        `That seems like a good direction to push on.`,
        `I would keep building from there.`
      ]
    };

    const attachmentLines = this.contextualAttachmentLine(context);
    const styleLines = linesByStyle[profile.humor ? "humor" : profile.analytical ? "analytical" : profile.energetic ? "energetic" : "default"];
    const chosen = this.pick(styleLines);
    return `${this.pick(openings)}${chosen}${attachmentLines}`;
  }

  contextualAttachmentLine(context) {
    const latest = [...context].reverse().find((m) => m.attachmentSummary);
    if (!latest) {
      return "";
    }

    const sourceName = this.app.users.find((u) => u.id === latest.senderId)?.name || "someone";
    const mood = latest.attachmentSummary.toLowerCase();
    if (mood.includes("text")) {
      return ` I noticed the image had visible text, which gives us a clean thing to respond to.`;
    }
    if (mood.includes("portrait") || mood.includes("face")) {
      return ` The picture looks like something personal, so I would treat it as a real cue from ${sourceName}.`;
    }
    if (mood.includes("gif") || mood.includes("animated")) {
      return ` The GIF feels playful and gives ${sourceName} a good opening.`;
    }
    return ` The attachment from ${sourceName} gives the chat more to react to.`;
  }

  trimToChatLine(text) {
    return this.sanitizeLine(text || "");
  }

  pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }
}

class ChatApp {
  constructor() {
    this.stateKey = "local-chat-text-state-v5";
    this.users = [];
    this.messages = [];
    this.selectedBotId = null;
    this.pendingAttachment = null;

    this.ui = {
      composerForm: document.getElementById("composerForm"),
      usersList: document.getElementById("usersList"),
      chatMessages: document.getElementById("chatMessages"),
      sendAsSelect: document.getElementById("sendAsSelect"),
      messageInput: document.getElementById("messageInput"),
      sendBtn: document.getElementById("sendBtn"),
      attachBtn: document.getElementById("attachBtn"),
      attachmentInput: document.getElementById("attachmentInput"),
      attachmentPreview: document.getElementById("attachmentPreview"),
      addBotBtn: document.getElementById("addBotBtn"),
      editorEmpty: document.getElementById("editorEmpty"),
      editorForm: document.getElementById("userEditorForm"),
      editName: document.getElementById("editName"),
      editPersonality: document.getElementById("editPersonality"),
      editBio: document.getElementById("editBio"),
      editAvatar: document.getElementById("editAvatar"),
      avatarSummary: document.getElementById("avatarSummary"),
      deleteBotBtn: document.getElementById("deleteBotBtn"),
      toggleBotsBtn: document.getElementById("toggleBotsBtn"),
      statusText: document.getElementById("statusText")
    };

    this.botDirector = new BotDirector(this);
    this.seedDefaults();
    this.bindEvents();
    this.renderAll();
    this.botDirector.start();
  }

  seedDefaults() {
    const stored = localStorage.getItem(this.stateKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        this.users = parsed.users.map((u) => new ChatUser(u));
        this.messages = parsed.messages.map((m) => new ChatMessage(m));
        this.messages = this.messages.map((m) => {
          m.targetId = "group";
          return m;
        });
        return;
      } catch (_) {
        localStorage.removeItem(this.stateKey);
      }
    }

    this.users = [
      new ChatUser({
        id: "main-user",
        name: "You",
        isBot: false,
        personality: "Main user",
        bio: "Controller of the simulation"
      }),
      new ChatUser({
        id: "bot-1",
        name: "Mina",
        isBot: true,
        personality: "energetic trend watcher",
        bio: "Talks fast and asks follow-up questions"
      }),
      new ChatUser({
        id: "bot-2",
        name: "Rafi",
        isBot: true,
        personality: "calm detail nerd",
        bio: "Usually grounds the conversation"
      }),
      new ChatUser({
        id: "bot-3",
        name: "Nox",
        isBot: true,
        personality: "dry humor and sarcasm",
        bio: "Makes short, punchy replies"
      })
    ];

    this.messages = [
      new ChatMessage({
        id: crypto.randomUUID(),
        senderId: "bot-1",
        targetId: "group",
        text: "Hey everyone, I am here and ready to jump in.",
        timestamp: Date.now()
      }),
      new ChatMessage({
        id: crypto.randomUUID(),
        senderId: "bot-2",
        targetId: "group",
        text: "I can already see a few directions this chat could go.",
        timestamp: Date.now()
      })
    ];
  }

  bindEvents() {
    this.ui.composerForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.handleSend();
    });
    this.ui.messageInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.handleSend();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        this.handleSend();
      }
    });

    this.ui.attachBtn.addEventListener("click", () => this.ui.attachmentInput.click());
    this.ui.attachmentInput.addEventListener("change", (event) => this.handleAttachment(event));

    this.ui.addBotBtn.addEventListener("click", () => this.addBot());
    this.ui.editorForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.saveSelectedBotEdits();
    });
    this.ui.deleteBotBtn.addEventListener("click", () => this.deleteSelectedBot());
    this.ui.editAvatar.addEventListener("change", (event) => this.handleAvatarChange(event));

    this.ui.toggleBotsBtn.addEventListener("click", () => {
      this.botDirector.botEnabled = !this.botDirector.botEnabled;
      this.ui.toggleBotsBtn.textContent = this.botDirector.botEnabled ? "Pause Bots" : "Resume Bots";
      this.ui.statusText.textContent = this.botDirector.botEnabled
        ? "Bots are thinking..."
        : "Bots paused by main user.";
    });
  }

  async handleAttachment(event) {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/") && file.type !== "image/gif") {
      alert("Only images or GIF files are allowed.");
      return;
    }

    const dataUrl = await ImageInterpreter.fileToDataUrl(file);
    const summary = await ImageInterpreter.summarizeDataUrl(dataUrl);
    this.pendingAttachment = { dataUrl, summary, name: file.name };
    this.renderAttachmentPreview();
  }

  renderAttachmentPreview() {
    if (!this.pendingAttachment) {
      this.ui.attachmentPreview.classList.add("hidden");
      this.ui.attachmentPreview.innerHTML = "";
      return;
    }

    this.ui.attachmentPreview.classList.remove("hidden");
    this.ui.attachmentPreview.innerHTML = `
      <span><strong>Attached:</strong> ${this.pendingAttachment.name} | ${this.pendingAttachment.summary}</span>
      <button id="clearAttachmentBtn" class="btn" type="button">Remove</button>
    `;

    const clearBtn = document.getElementById("clearAttachmentBtn");
    clearBtn.addEventListener("click", () => {
      this.pendingAttachment = null;
      this.ui.attachmentInput.value = "";
      this.renderAttachmentPreview();
    });
  }

  addBot() {
    const next = this.users.filter((u) => u.isBot).length + 1;
    const bot = new ChatUser({
      id: `bot-${Date.now()}`,
      name: `Bot${next}`,
      isBot: true,
      personality: "adaptable and chatty",
      bio: "Freshly generated fake user"
    });
    this.users.push(bot);
    this.selectedBotId = bot.id;
    this.renderAll();
    this.saveState();
  }

  getSelectedBot() {
    return this.users.find((u) => u.id === this.selectedBotId && u.isBot) || null;
  }

  selectBot(botId) {
    this.selectedBotId = botId;
    this.renderUsers();
    this.renderEditor();
  }

  async handleAvatarChange(event) {
    const selected = this.getSelectedBot();
    if (!selected) {
      return;
    }

    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      alert("Profile picture must be an image.");
      return;
    }

    selected.avatar = await ImageInterpreter.fileToDataUrl(file);
    selected.avatarSummary = await ImageInterpreter.summarizeDataUrl(selected.avatar);
    this.ui.avatarSummary.textContent = `Avatar readout: ${selected.avatarSummary}`;
    this.renderUsers();
    this.renderComposerOptions();
    this.saveState();
  }

  saveSelectedBotEdits() {
    const selected = this.getSelectedBot();
    if (!selected) {
      return;
    }

    selected.name = this.ui.editName.value.trim() || selected.name;
    selected.personality = this.ui.editPersonality.value.trim();
    selected.bio = this.ui.editBio.value.trim();
    this.renderAll();
    this.saveState();
  }

  deleteSelectedBot() {
    const selected = this.getSelectedBot();
    if (!selected) {
      return;
    }

    const keepUsers = this.users.filter((u) => u.id !== selected.id);
    this.users = keepUsers;
    this.messages = this.messages.filter((m) => m.senderId !== selected.id);
    this.selectedBotId = null;
    this.renderAll();
    this.saveState();
  }

  addMessage({ senderId, targetId, text, attachment, attachmentSummary }) {
    const message = new ChatMessage({
      id: crypto.randomUUID(),
      senderId,
      targetId,
      text,
      attachment,
      attachmentSummary,
      timestamp: Date.now()
    });
    this.messages.push(message);
    if (this.messages.length > 350) {
      this.messages = this.messages.slice(-350);
    }
    this.renderMessages();
    this.saveState();

    // Trigger fake-user conversational turns when any new message appears.
    this.botDirector.reactToNewMessage(message);
  }

  handleSend() {
    const senderId = this.ui.sendAsSelect.value;
    const text = this.ui.messageInput.value.trim();

    if (!text && !this.pendingAttachment) {
      return;
    }

    this.addMessage({
      senderId,
      targetId: "group",
      text,
      attachment: this.pendingAttachment ? this.pendingAttachment.dataUrl : null,
      attachmentSummary: this.pendingAttachment ? this.pendingAttachment.summary : ""
    });

    this.ui.messageInput.value = "";
    this.pendingAttachment = null;
    this.ui.attachmentInput.value = "";
    this.renderAttachmentPreview();
  }

  renderAll() {
    this.renderUsers();
    this.renderEditor();
    this.renderComposerOptions();
    this.renderMessages();
  }

  renderUsers() {
    this.ui.usersList.innerHTML = "";

    for (const user of this.users) {
      const li = document.createElement("li");
      li.className = `user-item ${user.id === this.selectedBotId ? "active" : ""}`;
      if (user.isBot) {
        li.addEventListener("click", () => this.selectBot(user.id));
      }

      li.innerHTML = `
        <img class="avatar" src="${user.avatar || this.defaultAvatar(user.name)}" alt="${user.name} avatar" />
        <div class="user-meta">
          <span class="user-name">${user.name}</span>
          <span class="user-role">${user.isBot ? "Fake AI user" : "Main user"}</span>
        </div>
      `;
      this.ui.usersList.appendChild(li);
    }
  }

  renderEditor() {
    const selected = this.getSelectedBot();
    if (!selected) {
      this.ui.editorEmpty.classList.remove("hidden");
      this.ui.editorForm.classList.add("hidden");
      this.ui.avatarSummary.textContent = "";
      return;
    }

    this.ui.editorEmpty.classList.add("hidden");
    this.ui.editorForm.classList.remove("hidden");
    this.ui.editName.value = selected.name;
    this.ui.editPersonality.value = selected.personality;
    this.ui.editBio.value = selected.bio;
    this.ui.avatarSummary.textContent = selected.avatarSummary
      ? `Avatar readout: ${selected.avatarSummary}`
      : "No avatar analyzed yet.";
  }

  renderComposerOptions() {
    const allOptions = this.users
      .map((u) => `<option value="${u.id}">${u.name}${u.isBot ? " (Fake AI)" : " (Main)"}</option>`)
      .join("");

    this.ui.sendAsSelect.innerHTML = allOptions;
    if (![...this.ui.sendAsSelect.options].some((o) => o.value === this.ui.sendAsSelect.value)) {
      this.ui.sendAsSelect.value = "main-user";
    }
  }

  renderMessages() {
    this.ui.chatMessages.innerHTML = "";

    for (const message of this.messages) {
      const sender = this.users.find((u) => u.id === message.senderId);
      if (!sender) {
        continue;
      }

      const isSelf = message.senderId === "main-user";
      const item = document.createElement("article");
      item.className = `message ${isSelf ? "self" : ""}`;

      const time = new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      item.innerHTML = `
        <div class="message-head">
          <span>${sender.name}</span>
          <span>${time}</span>
        </div>
        <div class="message-body">${this.escapeHtml(message.text || "")}</div>
        ${message.attachment ? `<img class="message-attachment" src="${message.attachment}" alt="attachment" />` : ""}
        ${message.attachmentSummary ? `<div class="attachment-note">AI image readout: ${message.attachmentSummary}</div>` : ""}
      `;

      this.ui.chatMessages.appendChild(item);
    }

    this.ui.chatMessages.scrollTop = this.ui.chatMessages.scrollHeight;
  }

  escapeHtml(text) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  defaultAvatar(seed) {
    const bg = this.hashColor(seed);
    const label = encodeURIComponent(seed.slice(0, 1).toUpperCase());
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60'><rect width='100%' height='100%' fill='${bg}'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' fill='white' font-size='28' font-family='sans-serif'>${label}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  hashColor(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i += 1) {
      h = seed.charCodeAt(i) + ((h << 5) - h);
      h |= 0;
    }
    const hue = Math.abs(h) % 360;
    return `hsl(${hue} 56% 52%)`;
  }

  saveState() {
    const payload = {
      users: this.users,
      messages: this.messages
    };
    localStorage.setItem(this.stateKey, JSON.stringify(payload));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new ChatApp();
});
