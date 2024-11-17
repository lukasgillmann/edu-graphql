var jwt = require("jsonwebtoken");
const { JITSI_PRK } = require("./jitsi_pk");

/**
 * Function generates a JaaS JWT.
 *
 * @param {*} data { room, user_id, email, name, avatar, start_time, duration, is_host }
 * @returns
 */
exports._getJitsiJWT = (data) => {
  const startDt = new Date(data.start_time);
  const endDt = new Date(data.start_time);

  const start = Math.round(startDt.setMinutes(startDt.getMinutes() - 15) / 1000); // Start time with second format
  const end = Math.round(endDt.setMinutes(endDt.getMinutes() + data.duration) / 1000);

  const token = jwt.sign(
    {
      aud: "jitsi",
      context: {
        user: {
          id: `${process.env.REACT_APP_SITE_NAME}-${data.user_id}`,
          name: data.name,
          avatar: data.avatar,
          email: data.email,
          moderator: data.is_host,
          regex: false,
        },
        features: {
          livestreaming: true,
          recording: data.is_host,
          transcription: true,
          "outbound-call": true,
        },
      },
      invite: false,
      iss: "chat",
      room: data.room,
      sub: process.env.REACT_APP_JITSI_APP_ID,
      exp: end,
      nbf: start,
    },
    JITSI_PRK,
    {
      algorithm: "RS256",
      header: {
        kid: process.env.REACT_APP_JITSI_API_KEY,
      },
    }
  );
  return token;
};
