const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { uniqueNamesGenerator } = require('unique-names-generator');
const { getLogger, setLogLevel } = require('./logger.js');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;

const log = getLogger("app");

if (!process.env.NODE_ENV) {
	log.warn("NODE_ENV not set, assuming dev environment");
	process.env.NODE_ENV = "development";
}

if (process.env.NODE_ENV === "example") {
	log.error("Invalid NODE_ENV! Aborting...");
	process.exit(1);
}

const config_path = path.resolve(process.cwd(), `env/${process.env.NODE_ENV}.env`);
log.info(`Reading config from ${process.env.NODE_ENV}.env`);
if (!fs.existsSync(config_path)) {
	log.error(`No config found! Things will break! ${config_path}`);
}
require('dotenv').config({ path: config_path });

if (process.env.LOG_LEVEL) {
	log.info(`Set log level to ${process.env.LOG_LEVEL}`);
	setLogLevel(process.env.LOG_LEVEL);
}

const app = express();
const server = http.createServer(app);

const { redisClient } = require('./redisclient.js');

const session = require('express-session');
let RedisStore = require('connect-redis')(session);
let sessionOpts = {
	store: new RedisStore({ client: redisClient }),
	secret: process.env.SESSION_SECRET || "opentogethertube",
	resave: false,
	saveUninitialized: true,
	unset: 'keep',
	cookie: {
		expires: false,
		maxAge: 99999999999,
	},
};
if (process.env.NODE_ENV === "production") {
	app.set('trust proxy', 1);
	sessionOpts.cookie.secure = true;
}
const sessions = session(sessionOpts);
app.use(sessions);

const usermanager = require("./usermanager");
passport.use(new LocalStrategy({ usernameField: 'email' }, usermanager.authCallback));
passport.serializeUser(usermanager.serializeUser);
passport.deserializeUser(usermanager.deserializeUser);
app.use(passport.initialize());
app.use(passport.session());
app.use(usermanager.passportErrorHandler);

app.use((req, res, next) => {
	if (!req.user && !req.session.username) {
		let username = uniqueNamesGenerator();
		log.debug(`Generated name for new user (on request): ${username}`);
		req.session.username = username;
		req.session.save();
	}
	else {
		log.debug("User is logged in, skipping username generation");
	}

	next();
});

const storage = require("./storage");
const roommanager = require("./roommanager");
const api = require("./api")(roommanager, storage);
roommanager.start(server, sessions);

const bodyParser = require('body-parser');
app.use(bodyParser.json());       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
	extended: true,
}));

// Redirect urls with trailing slashes
app.get('\\S+/$', (req, res) => {
	return res.redirect(301, req.path.slice(0, -1) + req.url.slice(req.path.length));
});

app.use((req, res, next) => {
	if (!req.path.startsWith("/api")) {
		next();
		return;
	}
	log.info(`> ${req.method} ${req.path}`);
	next();
});

function serveBuiltFiles(req, res) {
	fs.readFile("dist/index.html", (err, contents) => {
		res.setHeader("Content-type", "text/html");
		if (contents) {
			res.send(contents.toString());
		}
		else {
			res.status(500).send("Failed to serve page, try again later.");
		}
	});
}

app.use("/api/user", usermanager.router);
app.use("/api", api);
if (fs.existsSync("./dist")) {
	app.use(express.static(__dirname + "/dist", false));
	app.get("/", serveBuiltFiles);
	app.get("/faq", serveBuiltFiles);
	app.get("/rooms", serveBuiltFiles);
	app.get("/room/:roomId", serveBuiltFiles);
	app.get("/privacypolicy", serveBuiltFiles);
}
else {
	log.warn("no dist folder found");
}

//start our server
if (process.env.NODE_ENV !== "test") {
	server.listen(process.env.PORT || 3000, () => {
		log.info(`Server started on port ${server.address().port}`);
	});
}

module.exports = {
	app,
	redisClient,
	server,
};
