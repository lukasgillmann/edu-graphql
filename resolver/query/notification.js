// const AWS = require('aws-sdk');

const TYPES = ["course_complete", "module_complete", "course_assigned", "user_registered", "password_changed", "physical_session_assign"];

exports._listNotification = async (sqlAppClient, mongoHistClient, userId) => {
  let res = "";
  if (userId) {
    res = await sqlAppClient.query(`
      SELECT A.email, A.username, TRIM(CONCAT(A.first_name, ' ', A.last_name)) AS fullname, B.avatar, B.cover,
        IF(A.is_superuser = 1, 'SUPERADMIN', IF(A.is_staff = 1, 'STAFF', IF(C.state = 'granted', 'ADMIN', 'USER'))) AS permission
      FROM auth_user AS A
        LEFT JOIN auth_userprofile AS B ON A.id = B.user_id
        LEFT JOIN course_creators_coursecreator C ON C.user_id = A.id
      WHERE A.id = ${userId};
    `);

    res = res.length ? res[0] : {};

    if (res.email) {
      let logs = await mongoHistClient
        .db(process.env.MONGO_DB_INSPECT_NAME)
        .collection("email.log")
        .aggregate([{ $match: { to: res.email, type: { $in: TYPES } } }, { $sort: { time: -1 } }, { $limit: 10 }])
        .toArray();

      logs = logs.map((v) => ({ ...v, ...res }));

      return logs;
    }
  } else {
    let logs = await mongoHistClient
      .db(process.env.MONGO_DB_INSPECT_NAME)
      .collection("email.log")
      .aggregate([{ $match: { type: { $in: TYPES } } }, { $sort: { time: -1 } }, { $limit: 20 }])
      .toArray();

    // Attach user info
    const emails = logs.map((v) => v.to);
    if (emails.length) {
      const sqlRes = await sqlAppClient.query(`
        SELECT A.email, A.username, TRIM(CONCAT(A.first_name, ' ', A.last_name)) AS fullname, B.avatar, B.cover,
          IF(A.is_superuser = 1, 'SUPERADMIN', IF(A.is_staff = 1, 'STAFF', IF(C.state = 'granted', 'ADMIN', 'USER'))) AS permission
        FROM auth_user AS A
          LEFT JOIN auth_userprofile AS B ON A.id = B.user_id
          LEFT JOIN course_creators_coursecreator C ON C.user_id = A.id
        WHERE email IN (${emails.map((v) => '"' + v + '"')});
      `);
      logs = logs.map((item) => ({ ...item, ...(sqlRes.find((v) => v.email === item.to) || { username: "system", fullname: "Administrator" }) }));
    }

    return logs;
  }
  return [];
};
