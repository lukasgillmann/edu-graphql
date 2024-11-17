const { _getSQLAppClient, SYSTEM_USERS, _getMongoLogClient, _getMongoForumClient } = require("../common/utility");
const { _deleteUser } = require("./user");

exports.resetPlatform = async (_, obj, ctx) => {
  console.log("[********** RESETING PLATFORM **********]");
  const { permission } = ctx;
  if (["SUPERADMIN"].indexOf(permission) < 0) return false;

  const sqlAppClient = _getSQLAppClient();
  const mongoHistClient = await _getMongoLogClient();
  const mongoForumClient = await _getMongoForumClient();

  let query = "",
    res = "";
  try {
    /************************* Remove Users *****************************/
    const dangerUsers = [...SYSTEM_USERS, "support@univo.fr", "data1@id-x.fr", "data2@id-x.fr"];
    query = `
      SELECT A.id, A.email
      FROM auth_user A
        LEFT JOIN course_creators_coursecreator B ON A.id = B.user_id
      WHERE A.email NOT IN (${dangerUsers.map((v) => '"' + v + '"')}) AND A.is_superuser = 0 AND NOT (B.state <=> 'granted');
    `;
    res = await sqlAppClient.query(query);

    for (let user of res) {
      try {
        await _deleteUser(sqlAppClient, user.id);
      } catch (e) {
        console.log("[Delete User Error]", e);
      }
    }

    query = `
      SET SESSION foreign_key_checks=OFF;
      DELETE FROM schedules_scheduleexperience;
      DELETE FROM schedules_schedule;
      DELETE FROM student_courseenrollment;
      DELETE FROM license_plan;
      DELETE FROM auth_user_groups;
      DELETE FROM auth_group_permissions;
      DELETE FROM auth_group;
      DELETE FROM auth_userprofile;
      DELETE FROM student_certificate;
      DELETE FROM student_review;
      DELETE FROM student_router_track;
      DELETE FROM student_verticals_viewed;
      DELETE FROM chat_user;
      DELETE FROM meet_event;
      DELETE FROM meet_attendee;
      DELETE FROM meet_recording;
      DELETE FROM physical_session_users;
      DELETE FROM physical_session;
      SET SESSION foreign_key_checks=ON;
    `;
    await sqlAppClient.query(query);

    /************************* Clear Mongo History *****************************/
    await mongoHistClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("email.log").deleteMany({});
    await mongoHistClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("inspect.license").deleteMany({});
    await mongoHistClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("inspect.login_hist").deleteMany({});
    await mongoHistClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("inspect.module").deleteMany({});
    await mongoHistClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("inspect.vimeo").deleteMany({});
    await mongoHistClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("chat.hist").deleteMany({});

    await mongoForumClient.db(process.env.MONGO_DB_FORUM_NAME).collection("contents").deleteMany({});
    await mongoForumClient.db(process.env.MONGO_DB_FORUM_NAME).collection("subscriptions").deleteMany({});
    await mongoForumClient.db(process.env.MONGO_DB_FORUM_NAME).collection("users").deleteMany({});

    return true;
  } catch (e) {
    console.log("[RESET ERR]", e);
    return false;
  } finally {
    sqlAppClient.quit();
    mongoHistClient.close();
    mongoForumClient.close();

    console.log("[********** RESETING PLATFORM END **********]");
  }
};
