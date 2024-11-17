var { google } = require("googleapis");
const googleKey = require("../common/google-key.json");

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.calendars",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/admin.reports.usage.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/contacts",
];

const googleJwtClient = new google.auth.JWT(googleKey.client_email, null, googleKey.private_key, GOOGLE_SCOPES, "contact@myvirtualclass.fr", googleKey.client_id);

exports.googleCalendar = google.calendar({
  version: "v3",
  project: googleKey.project,
  auth: googleJwtClient,
});
