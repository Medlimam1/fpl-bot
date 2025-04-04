// index.js - FPL Telegram Bot (Pro Version with /myteam, improved /price, and AI Best 11)
require('dotenv').config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cheerio = require("cheerio");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const cron = require("node-cron");

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const userLang = {};
const userTeams = {};
const priceSubscribers = new Set();
let playerData = [];

const fetchFPLData = async () => {
  const res = await axios.get("https://fantasy.premierleague.com/api/bootstrap-static/");
  playerData = res.data.elements;
};

const getLang = (chatId) => userLang[chatId] || "ar";

const translations = {
  ar: {
    welcome: "👋 أهلاً بك في بوت تحليل FPL!",
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
    noTeam: "ℹ️ لم يتم العثور على فريق محفوظ.",
    yourTeam: "📋 فريقك الأخير:",
    best11: "🌟 التشكيلة المثالية للجولة القادمة (ذكاء اصطناعي):"
  }
};

const doc = new GoogleSpreadsheet(process.env.SHEET_ID);

async function storeTeam(chatId, team) {
  try {
    await doc.useServiceAccountAuth({
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    await sheet.addRow({ chatId, timestamp: new Date().toISOString(), team: team.join(", ") });
  } catch (err) {
    console.error("Google Sheet Error:", err);
  }
}

bot.onText(/\/start/, (msg) => {
  const lang = getLang(msg.chat.id);
  bot.sendMessage(msg.chat.id, translations[lang].welcome);
});

bot.onText(/\/myteam/, async (msg) => {
  const chatId = msg.chat.id;
  const lang = getLang(chatId);
  try {
    await doc.useServiceAccountAuth({
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    const latest = [...rows].reverse().find(row => row.chatId === String(chatId));
    if (!latest) return bot.sendMessage(chatId, translations[lang].noTeam);
    bot.sendMessage(chatId, `${translations[lang].yourTeam}\n${latest.team}`);
  } catch (err) {
    bot.sendMessage(chatId, "❌ حدث خطأ أثناء جلب الفريق.");
  }
});

bot.onText(/\/price/, async (msg) => {
  const chatId = msg.chat.id;
  const lang = getLang(chatId);
  priceSubscribers.add(chatId);
  bot.sendMessage(chatId, translations[lang].subscribed);
  sendPriceUpdate(chatId, lang);
});

async function sendPriceUpdate(chatId, lang) {
  try {
    const res = await axios.get("https://fplstatistics.co.uk/PriceChanges");
    const $ = cheerio.load(res.data);
    let rising = [], falling = [];

    $("table tr").each((i, el) => {
      const cols = $(el).find("td");
      const name = $(cols[1]).text().trim();
      const type = $(cols[4]).text().trim();
      const percent = parseFloat($(cols[6]).text().replace("%", ""));

      if (type.toLowerCase().includes("up") && percent >= 90) {
        rising.push(`${name} (${percent}%)`);
      } else if (type.toLowerCase().includes("down") && percent >= 80) {
        falling.push(`${name} (${percent}%)`);
      }
    });

    const msg = `📈 ${translations[lang].priceHeader}\n\n🔼 ${translations[lang].rising}\n${rising.join("\n") || "—"}\n\n🔽 ${translations[lang].falling}\n${falling.join("\n") || "—"}`;
    bot.sendMessage(chatId, msg);
  } catch (err) {
    bot.sendMessage(chatId, "❌ حدث خطأ أثناء جلب تغيّرات الأسعار.");
  }
}

bot.onText(/\/best11/, async (msg) => {
  const chatId = msg.chat.id;
  const lang = getLang(chatId);
  await fetchFPLData();
  const sorted = [...playerData]
    .filter(p => p.ep_next && p.chance_of_playing_next_round >= 75)
    .sort((a, b) => parseFloat(b.ep_next) - parseFloat(a.ep_next))
    .slice(0, 11);

  const message = [
    `🌟 ${translations[lang].best11}`,
    ...sorted.map(p => `✅ ${p.web_name} (${p.ep_next} pts)`)
  ].join("\n");

  bot.sendMessage(chatId, message);
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const lang = getLang(chatId);
  if (!text || typeof text !== 'string' || text.startsWith("/")) return;

  const players = text.split("\n").map(p => p.trim()).filter(Boolean);
  if (players.length < 11) return bot.sendMessage(chatId, translations[lang].tooShort);

  await fetchFPLData();
  userTeams[chatId] = players;
  await storeTeam(chatId, players);

  let total = 0;
  let responses = [];
  let captain = { name: "", points: 0 }, vice = { name: "", points: 0 };

  for (let name of players) {
    const p = playerData.find(p => `${p.first_name} ${p.second_name}`.toLowerCase().includes(name.toLowerCase()));
    if (!p) {
      responses.push(`${translations[lang].notFound} "${name}"`);
      continue;
    }
    const pts = parseFloat(p.ep_next) || 0;
    total += pts;
    if (pts > captain.points) {
      vice = { ...captain };
      captain = { name: p.web_name, points: pts };
    } else if (pts > vice.points) {
      vice = { name: p.web_name, points: pts };
    }
    responses.push(`✅ ${p.web_name} (${pts.toFixed(1)})`);
  }

  responses.push(`\n${translations[lang].captain} ${captain.name}`);
  responses.push(`${translations[lang].vice} ${vice.name}`);
  responses.push(`${translations[lang].totalPoints} ${total.toFixed(1)}`);
  bot.sendMessage(chatId, responses.join("\n"));
});

cron.schedule("0 22 * * *", () => {
  priceSubscribers.forEach(chatId => {
    const lang = getLang(chatId);
    sendPriceUpdate(chatId, lang);
  });
});
