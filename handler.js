"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { ApolloServer } = require("@apollo/server");
const { KeyvAdapter } = require("@apollo/utils.keyvadapter");
const { expressMiddleware } = require("@apollo/server/express4");
const { ApolloServerPluginCacheControl } = require("@apollo/server/plugin/cacheControl");

const { ApolloArmor } = require("@escape.tech/graphql-armor");
const serverlessExpress = require("@vendia/serverless-express");
const { AuthenticationError, ValidationError } = require("apollo-server-core");
const Keyv = require("keyv");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
var fs = require("fs");
const timeout = require("connect-timeout");

const { _getIPAddress, _getUserAgent, _parseJWTToken } = require("./resolver/common/utility");
const { sendWeeklyMails, syncCourseDifferencesFromDigital, updateMeetResults, correctMongoCourses } = require("./resolver/mutation/cron");

const typeDefs = fs.readFileSync("./schema.gql").toString("utf-8");
const { resolvers } = require("./resolvers");

//********************* Middlewares **********************/
const authMiddleware = (req, res, next) => {
  const { event } = serverlessExpress.getCurrentInvoke();

  if ((event.body || "").length > 20000) {
    res.status(500).json(new ValidationError("Character limit reached!"));
    return;
  }

  const { id, permission, expired, iat, is_ghost } = _parseJWTToken(event);

  // In case of introspection or get
  if (!permission && (!event.requestContext.http || event.requestContext.http.method != "POST" || event.body.includes("query IntrospectionQuery"))) {
    next();
    return;
  }

  // Middlware to check authorization/expire of the token
  if ((!id && !permission) || (!id && permission != "TESTUSER") || !permission) {
    res.status(500).json(new AuthenticationError("Not authorised"));
    return;
  }
  if (expired) {
    const currentTime = Math.floor(new Date().getTime() / 1000);
    if (currentTime > expired + iat) {
      res.status(500).json(new AuthenticationError("Token is expired"));
      return;
    }
  }
  // Now get the request browser information
  const ip = _getIPAddress(event.headers);
  const { device, browser } = _getUserAgent(event.headers);
  res.locals = {
    userId: id,
    permission: permission,
    expired: expired,
    iat: iat,
    ip: ip || "",
    device: device || "",
    browser: browser || "",
    is_ghost: is_ghost || false,
  };
  next();
};

const preventHttpMiddlware = (req, res, next) => {
  res.set("Cache-control", "no-cache");
  res.set("Content-type", "application/json; charset=utf-8");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");

  next();
};

//********************* Build Server **********************/
const armor = new ApolloArmor({
  costLimit: {
    enabled: true,
    maxCost: 1200,
    objectCost: 10,
    scalarCost: 1,
    depthCostFactor: 1,
    propagateOnRejection: true,
  },
  maxDirectives: {
    enabled: true,
    n: 50,
    propagateOnRejection: true,
  },
  maxAliases: {
    enabled: true,
    n: 15,
    propagateOnRejection: true,
  },
  maxDepth: {
    enabled: true,
    n: 5,
    propagateOnRejection: true,
  },
  maxTokens: {
    enabled: true,
    n: 1000,
    propagateOnRejection: true,
  },
});
const protection = armor.protect();

const apolloServer = new ApolloServer({
  typeDefs,
  resolvers,
  introspection: true,
  csrfPrevention: false,
  allowBatchedHttpRequests: false,
  cache: new KeyvAdapter(
    new Keyv({
      ttl: 300_000,
    })
  ),
  persistedQueries: {
    ttl: 300,
  },
  formatError: (formattedError) => {
    console.log("[******** ERR **********]", formattedError);
    return { message: "Internal server error!" };
  },
  plugins: [...protection.plugins, ApolloServerPluginCacheControl({ defaultMaxAge: 5 })],
  validationRules: [...protection.validationRules],
});

apolloServer.startInBackgroundHandlingStartupErrorsByLoggingAndFailingAllRequests();

const corsWhiteList = [
  process.env.REACT_APP_BASE_URL,
  process.env.REACT_APP_BASE_URL.replace("https://", "https://app."),
  process.env.REACT_APP_BASE_URL.replace("https://", "https://api."),
  "https://app.plateformedoctonet.com",
  "https://master.plateformedoctonet.com",
  "http://localhost:3000",
  "http://13.37.112.7",
  process.env.REACT_APP_JITSI_DOMAIN,
];
const app = express();

app.enable("trust proxy");
app.use(
  timeout(14_000),
  // cors({ origin: '*', credentials: true, optionsSuccessStatus: 200, }),
  cors({
    optionsSuccessStatus: 200,
    origin: (origin, callback) => {
      if (process.env.NODE_ENV == "offline" || corsWhiteList.indexOf(origin) !== -1 || !origin) {
        callback(null, true);
      } else {
        callback("Not allowed by CORS");
      }
    },
  }),
  preventHttpMiddlware,
  bodyParser.json({ limit: "1mb" }),
  bodyParser.urlencoded({ extended: true }),
  authMiddleware,
  expressMiddleware(apolloServer, {
    context: ({ res }) => {
      return res.locals;
    },
  })
);

exports.server = serverlessExpress({ app });

// Every Monday morning
exports.cronSendWeeklyMails = async () => await sendWeeklyMails();

// Every 1 hr
exports.cronUpdateMeets = async () => await updateMeetResults();

// Every day
exports.cronSyncCourses = async () => await syncCourseDifferencesFromDigital();

// Every day
exports.cronCorrectCourses = async () => await correctMongoCourses();
