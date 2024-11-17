const MySQLClient = require("serverless-mysql");
const { MongoClient } = require("mongodb");
const jwt = require("jsonwebtoken");
const path = require("path");
const download = require("download");
const { Vimeo } = require("vimeo");

const userAgent = require("express-useragent");

exports.JWTSECRET = "eduformasecret";
exports.DEFAULT_OUTPUT = { total: 0, page: 0, page_size: 10, data: [] };

exports.SYSTEM_USERS = [
  "ecommerce_worker@example.com",
  "login_service_user@fake.email",
  "enterprise_worker@example.com",
  "veda_service_user@example.com",
  "discovery_worker@example.com",
  "insights_worker@example.com",
  "credentials_worker@example.com",
  "designer_worker@example.com",
  "registrar_worker@example.com",
];

exports._getIPAddress = (headers) => {
  return headers["X-Forwarded-For"] || headers["x-forwarded-for"];
};

exports._getUserAgent = (headers) => {
  const parsed = userAgent.parse(headers["User-Agent"] || headers["user-agent"]);
  const device = parsed.isMobile ? "Mobile" : parsed.isTablet ? "Tablet" : "Desktop";
  const browser = `${parsed.browser} ${parsed.version}`;
  const os = parsed.os;
  return { device, browser, os };
};

exports._jsonReplacer = (key, value) => {
  if (typeof value === "boolean") {
    return value ? true : false;
  }
  return value;
};

exports._parseJWTToken = (event) => {
  let token;
  try {
    const authorization = event.headers["Authorization"] ? event.headers["Authorization"] : event.headers["authorization"];
    token = jwt.verify(authorization, this.JWTSECRET);
  } catch (e) {
    console.log("[jwt parse error]");
    return {};
  }
  return token;
};

exports._getSQLAppClient = () => {
  const client = MySQLClient({
    config: {
      host: process.env.MYSQL_DB_HOST,
      database: "edxapp",
      user: process.env.MYSQL_DB_USERNAME,
      password: process.env.MYSQL_DB_PASSWORD,
      multipleStatements: true,
      charset: "utf8mb4",
    },
  });
  return client;
};

exports._getMongoAppClient = async () => {
  const uri = `mongodb://${process.env.MONGO_DB_MAIN_USERNAME}:${process.env.MONGO_DB_MAIN_PASSWORD}@${process.env.MONGO_DB_MAIN_HOST}:${process.env.MONGO_DB_MAIN_PORT}/${process.env.MONGO_DB_MAIN_NAME}`;
  var client;
  if (process.env.MONGO_DB_INSPECT_HOST.includes("docdb.amazonaws.com")) {
    client = new MongoClient(`${uri}?tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false`, {
      tlsCAFile: "resolver/common/rds-combined-ca-bundle.pem", //Specify the DocDB; cert
    });
  } else client = new MongoClient(uri);
  try {
    await client.connect();
    return client;
  } catch (e) {
    console.log("[xblock mongoerr]", e);
    return null;
  }
};

exports._getMongoForumClient = async () => {
  const uri = `mongodb://${process.env.MONGO_DB_FORUM_USERNAME}:${process.env.MONGO_DB_FORUM_PASSWORD}@${process.env.MONGO_DB_FORUM_HOST}:${process.env.MONGO_DB_FORUM_PORT}/${process.env.MONGO_DB_FORUM_NAME}`;
  var client;
  if (process.env.MONGO_DB_INSPECT_HOST.includes("docdb.amazonaws.com")) {
    client = new MongoClient(`${uri}?tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false`, {
      tlsCAFile: "resolver/common/rds-combined-ca-bundle.pem", //Specify the DocDB; cert
    });
  } else client = new MongoClient(uri);
  try {
    await client.connect();
    return client;
  } catch (e) {
    console.log("[forum mongoerr]", e);
    return null;
  }
};

exports._getMongoLogClient = async () => {
  const uri = `mongodb://${process.env.MONGO_DB_INSPECT_USERNAME}:${process.env.MONGO_DB_INSPECT_PASSWORD}@${process.env.MONGO_DB_INSPECT_HOST}:${process.env.MONGO_DB_INSPECT_PORT}/${process.env.MONGO_DB_INSPECT_NAME}`;
  var client;
  if (process.env.MONGO_DB_INSPECT_HOST.includes("docdb.amazonaws.com")) {
    client = new MongoClient(`${uri}?tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false`, {
      tlsCAFile: "resolver/common/rds-combined-ca-bundle.pem", //Specify the DocDB; cert
    });
  } else client = new MongoClient(uri);
  try {
    await client.connect();
    return client;
  } catch (e) {
    console.log("[mongoerr]", e);
    return null;
  }
};

exports._dowloadVideo = async (url) => {
  const fileName = "recording.mp4";
  const filePath = path.resolve("/tmp", fileName);
  console.log("[downloading to ...]", filePath, url);
  // const dir = '/var/task/temp';
  // if (!fs.existsSync(dir)) {
  //   fs.mkdirSync(dir, { recursive: true });
  // }
  let res = await download(url, "/tmp", { filename: fileName });
  console.log("[download complete]", res);
  return filePath;
};

/**
 * Return vimeo transcode status with (complete | error | in_progress)
 */
exports._getVimeoTranscodeStatus = (vimeoId) => {
  const vimeoClient = new Vimeo(process.env.REACT_APP_VIMEO_API_PUBLIC, process.env.REACT_APP_VIMEO_API_PRIVATE, process.env.REACT_APP_VIMEO_API_TOKEN);
  const result = new Promise((resolve, reject) => {
    vimeoClient.request(`videos/${vimeoId}?fields=uri,upload.status,transcode.status`, function (err, res, statusCode) {
      if (err) {
        reject(err);
      } else {
        console.log(res.transcode);
        resolve(res.transcode.status);
      }
    });
  });
  return result;
};

exports._uploadToVimeo = (file, fileName) => {
  const vimeoClient = new Vimeo(process.env.REACT_APP_VIMEO_API_PUBLIC, process.env.REACT_APP_VIMEO_API_PRIVATE, process.env.REACT_APP_VIMEO_API_TOKEN);
  const result = new Promise((resolve, reject) => {
    vimeoClient.upload(
      file,
      { name: fileName },
      function (uri) {
        console.log(`File upload completed. Your Vimeo URI is: ${uri}`);
        resolve(uri);
      },
      function (bytesUploaded, bytesTotal) {
        const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
        console.info(bytesUploaded, bytesTotal, percentage + "%");
      },
      function (error) {
        console.error(`Vimeo Error: ${error}`);
        reject(`Vimeo Error: ${error}`);
      }
    );
  });
  return result;
};

exports._fillHTMLTemplate = (template, obj, replaceHolder = "") => {
  if (!template) return "";
  if (!obj || !Object.keys(obj).length) return template;
  let reg = "";
  Object.keys(obj).forEach((key) => {
    reg = new RegExp(`{{${key}}}`, "g");
    template = template.replace(reg, obj[key]);
  });
  if (replaceHolder) {
    reg = new RegExp(`{{CONTENT}}`, "g");
    template = template.replace(reg, replaceHolder);
  }
  return template;
};

exports._parseENV = (data) => {
  let lines = data.split("\n");
  lines = lines
    .map((v) => {
      const splits = v.split("=");
      if (splits.length != 2) return "";
      return {
        name: splits[0],
        value: splits[1].replace(/'/g, "").replace("\r", ""),
      };
    })
    .filter((v) => v);
  const obj = {};
  lines.forEach((v) => (obj[v.name] = v.value));
  return obj;
};

exports._getInvertColor = (bg) => {
  bg = parseInt(Number(bg.replace("#", "0x")), 10);
  bg = ~bg;
  bg = bg >>> 0;
  bg = bg & 0x00ffffff;
  bg = "#" + bg.toString(16).padStart(6, "0");
  return bg;
};

exports._generateRandomPwd = (len) => {
  let result = "";
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+=-";
  const charactersLength = characters.length;
  for (let i = 0; i < len; i += 1) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
};

exports._renderSQLValue = (val) => {
  if (val == null) return "NULL";
  else if (typeof val === "number") return val;
  else if (typeof val === "boolean") return val ? 1 : 0;
  return `'${val.replace(/'/g, "\\'")}'`;
};

exports._getSQLQuery = (type, table, columns, obj, where = "") => {
  let query = "",
    fields = "",
    values = "";
  if (type == "insert") {
    for (let key of Object.keys(obj)) {
      if (columns.find((v) => v == key)) {
        fields += `${key}, `;
        values += `${this._renderSQLValue(obj[key])}, `;
      }
    }
    query = fields ? `INSERT INTO ${table} (${fields.slice(0, -2)}) VALUES (${values.slice(0, -2)});` : "";
  } else if (type == "update") {
    for (let key of Object.keys(obj)) {
      if (columns.find((v) => v == key)) {
        fields += `${key} = ${this._renderSQLValue(obj[key])}, `;
      }
    }
    query = fields ? `UPDATE ${table} SET ${fields.slice(0, -2)} WHERE ${where}` : "";
  }
  return query;
};

exports._allowTimeTrack = async (sqlAppClient, userId, hash) => {
  try {
    const query = `SELECT hash FROM auth_userprofile WHERE user_id = ${userId}`;
    const res = await sqlAppClient.query(query);
    if (!res.length || res[0].hash != hash) return false;
    return true;
  } catch (e) {
    return false;
  }
};
