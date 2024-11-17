const axios = require("axios");
const { _getSQLAppClient } = require("../common/utility");

exports.getMeetingToken = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["TESTUSER"].indexOf(permission) < 0) return "";

  const { room, email, platform } = obj;
  const sqlAppClient = _getSQLAppClient();
  try {
    if (process.env.REACT_APP_SITE_NAME == platform) {
      const res = await sqlAppClient.query(
        `
          SELECT jwt
          FROM meet_attendee
          WHERE email=? AND room IN (
              SELECT room
              FROM meet_event
              WHERE room IN (
                  SELECT room
                  FROM meet_attendee
                  WHERE room=? AND email=?
              ) AND DATE_SUB(start_time, INTERVAL 15 MINUTE) < NOW() AND end_time > NOW()
          );
        `,
        [email, room, email]
      );
      return res.length ? res[0].jwt : "";
    } else if (process.env.REACT_APP_SITE_NAME == "dev") {
      const res = await axios.post(
        `https://${platform}.cloudplateforme.com/v2-api`,
        JSON.stringify({
          query: `
            query meeting_token_get($platform: String!, $room: String!, $email: String!) {
              meeting_token_get(platform: $platform, room: $room, email: $email)
            }
          `,
          variables: { platform, room, email },
        }),
        {
          headers: {
            Authorization: process.env.REACT_APP_TEST_JWT_TOKEN,
            "Content-Type": "application/json",
          },
        }
      );
      console.log("[meet token get res]", res.data);
      return res.data.data.meeting_token_get;
    }
  } catch (e) {
    console.log("[err]", e);
    return "";
  } finally {
    sqlAppClient.quit();
  }
};

exports._listMeeting = async (sqlAppClient, page, pageSize, isPast = false) => {
  const where = isPast ? "WHERE end_time <= NOW()" : "WHERE end_time > NOW()";
  const res = await sqlAppClient.query(
    `
    SELECT A.*,
      DATE_FORMAT(A.start_time, '%Y-%m-%dT%TZ') AS start_time,
      DATE_FORMAT(A.end_time, '%Y-%m-%dT%TZ') AS end_time,
      B.email tutor_email,
      CONCAT(B.first_name, ' ', B.last_name) AS tutor_name,
      B.avatar AS tutor_avatar
    FROM meet_event A
      LEFT JOIN virtual_tutor B ON A.tutor_id = B.id
    ${where} 
    LIMIT ?, ?;
    SELECT COUNT(*) AS total FROM meet_event ${where};`,
    [page * pageSize, pageSize]
  );

  const roomIds = res[0].map((v) => v.room);

  if (roomIds.length) {
    const courses = await sqlAppClient.query(
      `
      SELECT A.id, A.display_name, A.short_description, A.course_image_url, B.room
      FROM course_overviews_courseoverview A
        LEFT JOIN meet_course B ON A.id = B.course_id
      WHERE B.room IN (?)
      `,
      [roomIds]
    );

    for (let i = 0; i < res[0].length; i++) {
      res[0][i]["courses"] = courses.filter((v) => v.room == res[0][i].room);
    }
  }

  return { total: res[1][0].total, page: page, page_size: pageSize, data: res[0] };
};

exports.listMeeting = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { page, page_size } = obj;
  const sqlAppClient = _getSQLAppClient();

  try {
    return await this._listMeeting(sqlAppClient, page, page_size, false);
  } catch (e) {
    console.log("[ERR]", e);
  } finally {
    sqlAppClient.quit();
  }
};

exports._listMeetingUpcoming = async (sqlAppClient, userId, page, pageSize) => {
  const res = await sqlAppClient.query(
    `SELECT A.*, 
      DATE_FORMAT(A.start_time, '%Y-%m-%dT%TZ') AS start_time,
      TRIM(CONCAT(B.first_name, ' ', B.last_name)) tutor_name,
      B.avatar tutor_avatar
    FROM meet_event A
      LEFT JOIN virtual_tutor B ON A.tutor_id = B.id
    WHERE end_time > NOW() AND room IN (
      SELECT room FROM meet_attendee WHERE email IN (
        SELECT email FROM auth_user WHERE id=?
      )
    )
    LIMIT ?, ?;
    SELECT COUNT(*) AS total
    FROM meet_event
    WHERE end_time > NOW() AND room IN (
      SELECT room FROM meet_attendee WHERE email IN (
        SELECT email FROM auth_user WHERE id=?
      )
    );
  `,
    [userId, page * pageSize, pageSize, userId]
  );

  return { total: res[1][0].total, page, page_size: pageSize, data: res[0] };
};

exports.listMeetingUpcoming = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { user_id, page, page_size } = obj;
  const sqlAppClient = _getSQLAppClient();

  try {
    return await this._listMeetingUpcoming(sqlAppClient, user_id, page, page_size);
  } catch (e) {
    console.log("[ERR]", e);
  } finally {
    sqlAppClient.quit();
  }
};

exports._listMeetingRecording = async (sqlAppClient, courseId, page, pageSize) => {
  const query = courseId ? `LEFT JOIN meet_course B ON A.room = B.room AND B.course_id = '${courseId}'` : "";
  const res = await sqlAppClient.query(
    `SELECT C.*, 
      DATE_FORMAT(C.created, '%Y-%m-%dT%TZ') AS created,
      DATE_FORMAT(C.updated, '%Y-%m-%dT%TZ') AS updated,
      D.topic, D.description, D.duration,
      DATE_FORMAT(D.start_time, '%Y-%m-%dT%TZ') AS start_time,
      TRIM(CONCAT(E.first_name, ' ', E.last_name)) tutor_name,
      avatar tutor_avatar
    FROM (
      SELECT A.*
      FROM meet_recording A 
        LEFT JOIN meet_course B ON A.room = B.room
      WHERE A.status='complete' AND B.course_id LIKE '%${courseId}%'
      LIMIT ?, ?
    ) C
      LEFT JOIN meet_event D ON C.room = D.room
      LEFT JOIN virtual_tutor E ON D.tutor_id = E.id;
    SELECT COUNT(*) total
    FROM meet_recording A 
      LEFT JOIN meet_course B ON A.room = B.room
    WHERE A.status='complete' AND B.course_id LIKE '%${courseId}%'
  `,
    [page * pageSize, pageSize]
  );

  return { total: res[1][0].total, page: page, page_size: pageSize, data: res[0] };
};

exports.listMeetingRecording = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { course_id, page, page_size } = obj;
  const sqlAppClient = _getSQLAppClient();

  try {
    return await this._listMeetingRecording(sqlAppClient, course_id, page, page_size);
  } catch (e) {
    console.log("[ERR]", e);
  } finally {
    sqlAppClient.quit();
  }
};
