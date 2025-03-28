// FPL Telegram Bot with /price command, daily update, and Google Sheets integration
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const { createCanvas } = require("canvas");
const cron = require("node-cron");
const { GoogleSpreadsheet } = require("google-spreadsheet");
require("dotenv").config();

const token = process.env.TELEGRAM_BOT_TOKEN ;
const bot = new TelegramBot(token, { polling: true });

let playerData = [];
const userLang = {};
const userTeams = {};
const priceSubscribers = new Set();

const fetchFPLData = async () => {
  const res = await axios.get("https://fantasy.premierleague.com/api/bootstrap-static/");
  playerData = res.data.elements;
};

const getLang = (chatId) => userLang[chatId] || "ar";

const translations = {
  ar: {
    welcome: "👋 أهلاً بك في بوت تحليل FPL! أرسل /lang en أو /lang fr لتغيير اللغة.",
    tooShort: "⚠️ أرسل على الأقل 11 لاعب.",
    totalPoints: "📊 مجموع النقاط المتوقعة:",
    notFound: "❌ غير موجود",
    captain: "⭐ الكابتن المقترح:",
    vice: "🎯 نائب الكابتن:",
    langSet: "✅ تم تغيير اللغة إلى العربية",
    priceHeader: "📈 تغيّرات الأسعار المتوقعة الليلة:",
    rising: "🔼 سيرتفع السعر:",
    falling: "🔽 سينخفض السعر:",
    subscribed: "✅ سيتم إرسال تحديث تغيّرات الأسعار لك يوميًا في الليل.",
  },
  en: {
    welcome: "👋 Welcome to FPL Bot! Use /lang ar or /lang fr to change language.",
    tooShort: "⚠️ Please send at least 11 players.",
    totalPoints: "📊 Total Expected Points:",
    notFound: "❌ Not found",
    captain: "⭐ Suggested Captain:",
    vice: "🎯 Vice Captain:",
    langSet: "✅ Language set to English",
    priceHeader: "📈 Tonight's Expected Price Changes:",
    rising: "🔼 Price Rising:",
    falling: "🔽 Price Falling:",
    subscribed: "✅ You will now receive daily price updates at night.",
  },
  fr: {
    welcome: "👋 Bienvenue dans le bot FPL ! Utilisez /lang ar ou /lang en pour changer de langue.",
    tooShort: "⚠️ Envoyez au moins 11 joueurs.",
    totalPoints: "📊 Total des points attendus:",
    notFound: "❌ Introuvable",
    captain: "⭐ Capitaine suggéré:",
    vice: "🎯 Vice-capitaine:",
    langSet: "✅ Langue changée en français",
    priceHeader: "📈 Changements de prix attendus ce soir:",
    rising: "🔼 Augmentations de prix:",
    falling: "🔽 Baisses de prix:",
    subscribed: "✅ Vous recevrez désormais les changements de prix tous les soirs.",
  },
};

const doc = new GoogleSpreadsheet(process.env.SHEET_ID);

async function storeTeamInSheet(chatId, team) {
  try {
    await doc.useServiceAccountAuth({
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    });
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    await sheet.addRow({ chatId, timestamp: new Date().toISOString(), team: team.join(", ") });
  } catch (err) {
    console.error("Google Sheet Error:", err);
  }
}

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

bot.onText(/\/price/, async (msg) => {
  const lang = getLang(msg.chat.id);
  priceSubscribers.add(msg.chat.id);
  bot.sendMessage(msg.chat.id, translations[lang].subscribed);
  sendPriceUpdate(msg.chat.id, lang);
});

async function sendPriceUpdate(chatId, lang) {
  try {
    const res = await axios.get("https://fplstatistics.co.uk/PriceChanges");
    const $ = cheerio.load(res.data);
    const rows = $("#ismTable tbody tr");

    let rising = [];
    let falling = [];

    rows.each((_, row) => {
      const cols = $(row).find("td");
      const name = $(cols[1]).text().trim();
      const change = $(cols[6]).text().trim().replace("%", "");
      const delta = parseFloat(change);

      const type = $(cols[4]).text().trim();
      if (type.toLowerCase().includes("up") && delta >= 90) {
        rising.push(`${name} (${delta}%)`);
      }
      if (type.toLowerCase().includes("down") && delta >= 80) {
        falling.push(`${name} (${delta}%)`);
      }
    });

    const msgText = [
      translations[lang].priceHeader,
      `\n${translations[lang].rising}`,
      rising.length ? rising.join("\n") : "—",
      `\n${translations[lang].falling}`,
      falling.length ? falling.join("\n") : "—",
    ].join("\n");

    bot.sendMessage(chatId, msgText);
  } catch (err) {
    bot.sendMessage(chatId, "❌ خطأ في جلب تغيّرات الأسعار.");
  }
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const lang = getLang(chatId);

  if (!text || typeof text !== 'string' || text.startsWith("/")) return;

  const players = text.split("\n").map(p => p.trim()).filter(Boolean);
  if (players.length < 11) return bot.sendMessage(chatId, translations[lang].tooShort);

  await fetchFPLData();
  userTeams[chatId] = players;
  await storeTeamInSheet(chatId, players);

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

cron.schedule("0 22 * * *", () => {
  priceSubscribers.forEach(chatId => {
    const lang = getLang(chatId);
    sendPriceUpdate(chatId, lang);
  });
});
