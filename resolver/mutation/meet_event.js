const axios = require("axios");
const { googleCalendar } = require("../common/google-util");
const { _getJitsiJWT } = require("../common/jitsi");
const { _toSQLTime, _toIsoString } = require("../common/time");
const { _getSQLAppClient } = require("../common/utility");

exports.createMeeting = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  // duration: minute
  const { topic, description, start_time, duration, course_ids, tutor_id } = obj;

  const sqlAppClient = _getSQLAppClient();

  let [res, query] = ["", ""];
  const startDate = new Date(start_time);
  const endDate = new Date(new Date(startDate).getTime() + duration * 60_000);

  try {
    const room = `${process.env.REACT_APP_SITE_NAME}-${new Date().getTime()}`;

    res = await sqlAppClient.query(
      `
      SELECT id, first_name, last_name, email FROM virtual_tutor WHERE id=?;
      SELECT DISTINCT(A.email), A.id, A.first_name, A.last_name, C.avatar
      FROM auth_user A
        LEFT JOIN auth_userprofile C ON A.id = C.user_id
        INNER JOIN student_courseenrollment B ON A.id = B.user_id AND B.is_active = 1 AND B.course_id IN (?);
    `,
      [tutor_id, course_ids]
    );

    const tutors = res[0].map((v) => ({
      ...v,
      jwt: _getJitsiJWT({
        room: room,
        user_id: `tutor-${v.id}`,
        email: v.email,
        name: `${v.first_name} ${v.last_name}`.trim(),
        avatar: `https://s3.eu-west-3.amazonaws.com/${process.env.REACT_APP_S3_BUCKET_NAME}/dev/logo.png`,
        start_time: start_time,
        duration: duration,
        is_host: true,
      }),
    }));
    const users = res[1].map((v) => ({
      ...v,
      jwt: _getJitsiJWT({
        room: room,
        user_id: `user-${v.id}`,
        email: v.email,
        name: `${v.first_name} ${v.last_name}`.trim(),
        avatar: v.avatar,
        start_time: start_time,
        duration: duration,
        is_host: false,
      }),
    }));
    if (!tutors.length || !users.length) throw Error("Tutor or user does not exist!");

    // Now send calendar invite
    const event = {
      summary: topic,
      description: description,
      location: process.env.REACT_APP_SITE_DISPLAY_NAME,
      start: { dateTime: _toIsoString(startDate) },
      end: { dateTime: _toIsoString(endDate) },
      attendees: [...tutors, ...users].map((v) => ({ email: v.email })).filter((v) => v.email),
      conferenceData: {
        entryPoints: [
          {
            entryPointType: "video",
            uri: `${process.env.REACT_APP_JITSI_DOMAIN}/start/${process.env.REACT_APP_SITE_NAME}/${room}`,
            label: "",
          },
        ],
        conferenceSolution: {
          name: "",
          key: { type: "addOn" },
        },
      },
      guestsCanInviteOthers: true,
      sendNotifications: true,
      sendUpdates: "all",
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 24 * 60 },
          { method: "popup", minutes: 10 },
        ],
      },
    };

    res = await new Promise((resolve, reject) => {
      googleCalendar.events.insert(
        {
          calendarId: process.env.GOOGLE_CALENDAR_ID,
          resource: event,
          sendNotifications: true,
          sendUpdates: "all",
          conferenceDataVersion: 1,
        },
        function (err, result) {
          if (err) {
            console.log("[err]", err);
            reject("[Calendar insert error]");
            return;
          }
          resolve(result.data);
        }
      );
    });
    const eventId = res.id;

    // Now insert event and attendees
    query = course_ids.map((v) => `('${room}', '${v}')`).join(",");
    query = `
      INSERT INTO meet_event (room, event_id, topic, description, start_time, end_time, duration, tutor_id)
      VALUES ('${room}', '${eventId}', ${sqlAppClient.escape(topic)}, ${sqlAppClient.escape(description)}, '${_toSQLTime(startDate)}', '${_toSQLTime(endDate)}', ${duration}, ${tutor_id});
      INSERT INTO meet_attendee (room, email, is_host, status, jwt) VALUES ('${room}', '${tutors[0].email}', ${true}, 'needsAction', '${tutors[0].jwt}');
      INSERT INTO meet_course (room, course_id) VALUES ${query};
    `;

    for (let user of users) {
      query += `INSERT INTO meet_attendee (room, email, is_host, status, jwt) VALUES ('${room}', '${user.email}', ${false}, 'needsAction', '${user.jwt}');`;
    }
    await sqlAppClient.query(query);

    return room;
  } catch (e) {
    console.log("[err]", e);
    return null;
  } finally {
    sqlAppClient.quit();
  }
};

exports.editMeeting = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  // duration: minute
  const { room, topic, description, start_time, duration, course_ids, tutor_id } = obj;

  const sqlAppClient = _getSQLAppClient();

  let [res, query] = ["", ""];
  const startDate = new Date(start_time);
  const endDate = new Date(new Date(startDate).getTime() + duration * 60_000);

  try {
    res = await sqlAppClient.query(
      `
      SELECT id, first_name, last_name, email FROM virtual_tutor WHERE id=?;
      SELECT DISTINCT(A.email), A.id, A.first_name, A.last_name, C.avatar
      FROM auth_user A
        LEFT JOIN auth_userprofile C ON A.id = C.user_id
        INNER JOIN student_courseenrollment B ON A.id = B.user_id AND B.is_active = 1 AND B.course_id IN (?);
      SELECT event_id FROM meet_event WHERE room=?;
    `,
      [tutor_id, course_ids, room]
    );

    const eventId = res[2].length ? res[2][0].event_id : null;
    if (!eventId) throw Error("Google calendar event id is not exist in meet_event table!");

    const tutors = res[0].map((v) => ({
      ...v,
      jwt: _getJitsiJWT({
        room: room,
        user_id: `tutor-${v.id}`,
        email: v.email,
        name: `${v.first_name} ${v.last_name}`.trim(),
        avatar: `https://s3.eu-west-3.amazonaws.com/${process.env.REACT_APP_S3_BUCKET_NAME}/dev/logo.png`,
        start_time: start_time,
        duration: duration,
        is_host: true,
      }),
    }));
    const users = res[1].map((v) => ({
      ...v,
      jwt: _getJitsiJWT({
        room: room,
        user_id: `user-${v.id}`,
        email: v.email,
        name: `${v.first_name} ${v.last_name}`.trim(),
        avatar: v.avatar,
        start_time: start_time,
        duration: duration,
        is_host: false,
      }),
    }));
    if (!tutors.length || !users.length) throw Error("Tutor or user does not exist!");

    // Now send calendar invite
    const event = {
      summary: topic,
      description: description,
      location: process.env.REACT_APP_SITE_DISPLAY_NAME,
      start: { dateTime: _toIsoString(startDate) },
      end: { dateTime: _toIsoString(endDate) },
      attendees: [...tutors, ...users].map((v) => ({ email: v.email })).filter((v) => v.email),
      conferenceData: {
        entryPoints: [
          {
            entryPointType: "video",
            uri: `${process.env.REACT_APP_JITSI_DOMAIN}/start/${process.env.REACT_APP_SITE_NAME}/${room}`,
            label: "",
          },
        ],
        conferenceSolution: {
          name: "",
          key: { type: "addOn" },
        },
      },
      guestsCanInviteOthers: true,
      sendNotifications: true,
      sendUpdates: "all",
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 24 * 60 },
          { method: "popup", minutes: 10 },
        ],
      },
    };

    await new Promise((resolve, reject) => {
      googleCalendar.events.patch(
        {
          calendarId: process.env.GOOGLE_CALENDAR_ID,
          eventId: eventId,
          resource: event,
          sendNotifications: true,
          sendUpdates: "all",
          conferenceDataVersion: 1,
        },
        function (err, result) {
          if (err) {
            console.log("[err]", err);
            reject("[Calendar patch error]");
            return;
          }
          resolve(result.data);
        }
      );
    });

    // Now insert event and attendees
    query = course_ids.map((v) => `('${room}', '${v}')`).join(",");
    query = `
      UPDATE meet_event SET topic=${sqlAppClient.escape(topic)}, description=${sqlAppClient.escape(description)}, start_time='${_toSQLTime(startDate)}', end_time='${_toSQLTime(endDate)}', duration=${duration}, tutor_id=${tutor_id} WHERE room=${sqlAppClient.escape(room)};
      DELETE FROM meet_attendee WHERE room=${sqlAppClient.escape(room)};
      INSERT INTO meet_attendee (room, email, is_host, status, jwt) VALUES ('${room}', '${tutors[0].email}', ${true}, 'needsAction', '${tutors[0].jwt}');
      DELETE FROM meet_course WHERE room=${sqlAppClient.escape(room)};
      INSERT INTO meet_course (room, course_id) VALUES ${query};
    `;

    for (let user of users) {
      query += `INSERT INTO meet_attendee (room, email, is_host, status, jwt) VALUES ('${room}', '${user.email}', ${false}, 'needsAction', '${user.jwt}');`;
    }
    await sqlAppClient.query(query);

    return true;
  } catch (e) {
    console.log("[err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports.insertMeetingRecording = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["TESTUSER"].indexOf(permission) < 0) return false;

  // duration: minute
  const { room, url, platform } = obj;
  const sqlAppClient = _getSQLAppClient();

  try {
    if (process.env.REACT_APP_SITE_NAME == platform) {
      await sqlAppClient.query(`UPDATE meet_event SET recording_url = ? WHERE room = ?`, [url, room]);
    } else if (process.env.REACT_APP_SITE_NAME == "dev") {
      const res = await axios.post(
        `https://${platform}.cloudplateforme.com/v2-api`,
        JSON.stringify({
          query: `
            mutation meeting_recording_create($platform: String!, $room: String!, $url: String!) {
              meeting_recording_create(platform: $platform, room: $room, url: $url)
            }
          `,
          variables: { platform, room, url },
        }),
        {
          headers: {
            Authorization: process.env.REACT_APP_TEST_JWT_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );
      console.log("[meet record insert res]", res.data);
      return res.data.data.meeting_recording_create;
    }

    return true;
  } catch (e) {
    console.log("[recording insert err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports._deleteMeeting = async (sqlAppClient, room) => {
  const res = await sqlAppClient.query(`SELECT event_id FROM meet_event WHERE room='${room}'`);
  const eventId = res.length ? res[0].event_id : null;
  if (!eventId) return;

  return new Promise((resolve, reject) => {
    googleCalendar.events.delete(
      {
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        eventId: eventId,
        sendNotifications: true,
        sendUpdates: "all",
        conferenceDataVersion: 1,
      },
      async function (err, result) {
        if (err) {
          console.log("[calendar delete error]", err);
          reject("[Calendar delete error]");
          return;
        }
        // resolve(result.data);
        await sqlAppClient.query(`
          DELETE FROM meet_attendee WHERE room = '${room}';
          DELETE FROM meet_course WHERE room = '${room}';
          DELETE FROM meet_recording WHERE room = '${room}';
          DELETE FROM meet_event WHERE room = '${room}';
        `);
        resolve(result.data);
      }
    );
  });
};

exports.deleteMeeting = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { room } = obj;

  const sqlAppClient = _getSQLAppClient();

  try {
    await this._deleteMeeting(sqlAppClient, room);
    return true;
  } catch (e) {
    console.log("[err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};
