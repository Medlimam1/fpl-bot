// FPL Telegram Bot - Advanced Version with Transfers, Languages, and Team Image
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const { createCanvas, loadImage } = require("canvas");

const token = "7566434947:AAG-Ep3WrvoHflkDASBGTmqFI2pazr_aij4";
const bot = new TelegramBot(token, { polling: true });

let playerData = [];
let teamData = [];
let fixturesData = [];
const userLang = {};
const userTeams = {};

const translations = {
  ar: {
    welcome: "👋 أهلاً بك في بوت تحليل FPL! أرسل /lang en أو /lang fr لتغيير اللغة.",
    askTeam: "📌 أرسل فريقك الآن (كل اسم لاعب في سطر)",
    tooShort: "⚠️ أرسل على الأقل 11 لاعب.",
    totalPoints: "📊 مجموع النقاط المتوقعة:",
    notFound: "❌ غير موجود",
    captain: "⭐ الكابتن المقترح:",
    vice: "🎯 نائب الكابتن:",
    langSet: "✅ تم تغيير اللغة إلى العربية",
    transferHeader: "🔁 اقتراحات تبديلات:",
    transferOut: "🚫 اقتراح إخراج:",
    transferIn: "✅ اقتراح إدخال:",
    imageCaption: "📸 صورة مبدئية لتشكيلة الفريق"
  },
  en: {
    welcome: "👋 Welcome to FPL Bot! Use /lang ar or /lang fr to change language.",
    askTeam: "📌 Please send your team (one player per line)",
    tooShort: "⚠️ Please send at least 11 players.",
    totalPoints: "📊 Total Expected Points:",
    notFound: "❌ Not found",
    captain: "⭐ Suggested Captain:",
    vice: "🎯 Vice Captain:",
    langSet: "✅ Language set to English",
    transferHeader: "🔁 Transfer Suggestions:",
    transferOut: "🚫 Suggested OUT:",
    transferIn: "✅ Suggested IN:",
    imageCaption: "📸 Preview of your team lineup"
  },
  fr: {
    welcome: "👋 Bienvenue dans le bot FPL ! Utilisez /lang ar ou /lang en pour changer de langue.",
    askTeam: "📌 Envoyez votre équipe (un joueur par ligne)",
    tooShort: "⚠️ Envoyez au moins 11 joueurs.",
    totalPoints: "📊 Total des points attendus:",
    notFound: "❌ Introuvable",
    captain: "⭐ Capitaine suggéré:",
    vice: "🎯 Vice-capitaine:",
    langSet: "✅ Langue changée en français",
    transferHeader: "🔁 Suggestions de transferts:",
    transferOut: "🚫 Joueurs à remplacer:",
    transferIn: "✅ Joueurs recommandés:",
    imageCaption: "📸 Aperçu de votre formation"
  },
};

const fetchFPLData = async () => {
  const res = await axios.get("https://fantasy.premierleague.com/api/bootstrap-static/");
  playerData = res.data.elements;
  teamData = res.data.teams;
};

const fetchFixtures = async () => {
  const res = await axios.get("https://fantasy.premierleague.com/api/fixtures/?future=1");
  fixturesData = res.data;
};

const getLang = (chatId) => userLang[chatId] || "ar";

bot.onText(/\/lang (.+)/, (msg, match) => {
  const lang = match[1];
  if (["ar", "en", "fr"].includes(lang)) {
    userLang[msg.chat.id] = lang;
    bot.sendMessage(msg.chat.id, translations[lang].langSet);
  }
});

bot.onText(/\/start/, (msg) => {
  const lang = getLang(msg.chat.id);
  bot.sendMessage(msg.chat.id, translations[lang].welcome);
});

bot.onText(/\/transfer/, async (msg) => {
  const lang = getLang(msg.chat.id);
  const team = userTeams[msg.chat.id];
  if (!team || team.length < 11) return bot.sendMessage(msg.chat.id, translations[lang].tooShort);

  await fetchFPLData();

  const suggestions = [];
  const underperformers = [];

  for (let name of team) {
    const player = playerData.find(p => `${p.first_name} ${p.second_name}`.toLowerCase().includes(name.toLowerCase()));
    if (!player) continue;
    const pts = parseFloat(player.ep_next) || 0;
    if (pts < 3 || player.status !== 'a') {
      underperformers.push({ name: player.web_name, price: player.now_cost / 10 });
    }
  }

  const topPerformers = playerData
    .filter(p => parseFloat(p.ep_next) > 5 && p.status === 'a')
    .sort((a, b) => parseFloat(b.ep_next) - parseFloat(a.ep_next))
    .slice(0, 10);

  suggestions.push(`${translations[lang].transferHeader}`);
  suggestions.push(`\n${translations[lang].transferOut}`);
  underperformers.forEach(p => suggestions.push(`- ${p.name} (${p.price}m)`));
  suggestions.push(`\n${translations[lang].transferIn}`);
  topPerformers.forEach(p => suggestions.push(`+ ${p.web_name} (${p.now_cost / 10}m)`));

  bot.sendMessage(msg.chat.id, suggestions.join("\n"));
});

bot.onText(/\/image/, async (msg) => {
  const lang = getLang(msg.chat.id);
  const canvas = createCanvas(700, 500);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#006400";
  ctx.fillRect(0, 0, 700, 500);
  ctx.fillStyle = "#fff";
  ctx.font = "20px Arial";
  ctx.fillText("Your FPL Team", 250, 50);

  const team = userTeams[msg.chat.id] || [];
  ctx.font = "16px Arial";
  team.forEach((name, i) => {
    ctx.fillText(name, 50, 100 + i * 25);
  });

  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync("team.png", buffer);
  bot.sendPhoto(msg.chat.id, buffer, { caption: translations[lang].imageCaption });
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const lang = getLang(chatId);

  if (!text || typeof text !== 'string' || text.startsWith("/")) return;
  

  const players = text.split("\n").map(p => p.trim()).filter(Boolean);
  if (players.length < 11) return bot.sendMessage(chatId, translations[lang].tooShort);

  await fetchFPLData();
  await fetchFixtures();

  userTeams[chatId] = players;

  let totalScore = 0;
  let responses = [];
  let captain = { name: "", points: 0 };
  let vice = { name: "", points: 0 };

  for (let name of players) {
    const player = playerData.find(p => `${p.first_name} ${p.second_name}`.toLowerCase().includes(name.toLowerCase()));
    if (!player) {
      responses.push(`${translations[lang].notFound} "${name}"`);
      continue;
    }
    const pts = parseFloat(player.ep_next) || 0;
    totalScore += pts;
    if (pts > captain.points) {
      vice = { ...captain };
      captain = { name: player.web_name, points: pts };
    } else if (pts > vice.points) {
      vice = { name: player.web_name, points: pts };
    }
    responses.push(`✅ ${player.web_name} (${pts.toFixed(1)})`);
  }

  responses.push(`\n${translations[lang].captain} ${captain.name}`);
  responses.push(`${translations[lang].vice} ${vice.name}`);
  responses.push(`${translations[lang].totalPoints} ${totalScore.toFixed(1)}`);
  bot.sendMessage(chatId, responses.join("\n"));
});
