const { _getMongoLogClient, _fillHTMLTemplate, _getSQLAppClient } = require("../common/utility");
const ObjectId = require("mongodb").ObjectId;
const { sendEmail } = require("../query/email");

exports.createComment = async (_, obj, ctx) => {
  const { userId, permission, is_ghost } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0 || is_ghost) return null;

  const {
    author_name,
    author_fullname,
    visible,
    course_id,
    discussion_id,
    course_title,
    section_title,
    sequence_title,
    vertical_title,
    body,
    files, // { url, type },
  } = obj.input;

  const mongoHistClient = await _getMongoLogClient();
  const sqlAppClient = await _getSQLAppClient();

  try {
    let payload = {
      author_id: userId,
      author_name: author_name,
      author_fullname: author_fullname,
      visible: visible,
      role: permission,
      type: discussion_id ? "unit" : "course",
      course_id: course_id,
      discussion_id: discussion_id,
      course_title: course_title,
      section_title: section_title,
      sequence_title: sequence_title,
      vertical_title: vertical_title,
      body: body,
      files: files,
      vote_up: [],
      vote_up_count: 0,
      vote_down: [],
      vote_down_count: 0,
      reply: [],
      created_at: new Date(),
      updated_at: new Date(),
    };

    let comment = await mongoHistClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("comment").insertOne(payload);

    // Now send email to the user/admin // ****************************************************************
    const emailType = "course_comment";

    let query = `
      SELECT A.username, A.first_name, A.last_name, A.email 
      FROM auth_user A
        LEFT JOIN auth_userprofile B ON A.id = B.user_id
      WHERE A.id=${userId} AND B.email_comment=1;
    `;
    let res = await sqlAppClient.query(query);
    if (res && res.length) {
      res = res[0];
      const firstName = res.first_name || res.username;
      const lastName = res.last_name;
      const email = res.email;

      query = `SELECT subject, content FROM email_template WHERE type='${emailType}' AND enabled=1 AND end_user='admin'`;
      res = await sqlAppClient.query(query);
      const adminHtml = res && res.length ? res[0].content : null;
      const subject = res && res.length ? res[0].subject : "";

      if (adminHtml) {
        query = `SELECT display_name FROM course_overviews_courseoverview WHERE id='${course_id}'`;
        res = await sqlAppClient.query(query);
        const courseTitle = res && res.length ? res[0].display_name : "";

        const values = {
          PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
          SURNAME: firstName,
          NAME: lastName,
          USER_ID: email,
          COURSE_TITLE: courseTitle,
          COMMENT_CONTENT: body,
          LOGIN_LINK: process.env.REACT_APP_AUTH_ENDPOINT,
          CURRENT_DATE: new Date().toISOString(),
        };

        await sendEmail(emailType, process.env.REACT_APP_CONTACT_EMAIL, _fillHTMLTemplate(subject, values), _fillHTMLTemplate(adminHtml, values), courseTitle);
      }
      // ***************************************************************************************************
    }

    return comment.insertedId;
  } catch (e) {
    console.log("[err]", e);

    return {};
  } finally {
    mongoHistClient.close();
    sqlAppClient.quit();
  }
};

exports.editComment = async (_, obj, ctx) => {
  const { userId, permission, is_ghost } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0 || is_ghost) return false;

  const { comment_id, body, files, visible = true } = obj.input;
  const mongoHistClient = await _getMongoLogClient();

  try {
    const filter = {
      _id: new ObjectId(comment_id),
      author_id: userId,
    };

    const payload = {
      $set: {
        body: body,
        files: files,
        visible: visible,
        updated_at: new Date(),
      },
    };

    const comment = await mongoHistClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("comment").updateOne(filter, payload);

    return comment.acknowledged;
  } catch (e) {
    return false;
  } finally {
    mongoHistClient.close();
  }
};

exports.editThirdComment = async (_, obj, ctx) => {
  const { userId, permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return false;

  const { comment_id, author_name, author_fullname, visible, body, files } = obj.input;
  const mongoHistClient = await _getMongoLogClient();

  try {
    const filter = {
      _id: new ObjectId(comment_id),
    };

    const payload = {
      $push: {
        reply: {
          $each: [
            {
              author_id: userId,
              author_name: author_name,
              author_fullname: author_fullname,
              visible: visible,
              body: body,
              files: files,
              created_at: new Date(),
            },
          ],
          $position: 0,
          $slice: -10,
        },
      },
      $set: {
        updated_at: new Date(),
      },
    };

    const comment = await mongoHistClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("comment").updateOne(filter, payload);

    return comment.modifiedCount != 0 ? true : false;
  } catch (e) {
    return false;
  } finally {
    mongoHistClient.close();
  }
};

exports.editCommentVote = async (_, obj, ctx) => {
  const { userId, permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return false;

  const { comment_id, is_up } = obj;
  const mongoHistClient = await _getMongoLogClient();

  try {
    const filter = {
      _id: new ObjectId(comment_id),
      ...(is_up ? { vote_up: { $ne: userId } } : { vote_down: { $ne: userId } }),
    };

    const payload = {
      $push: {
        ...(is_up ? { vote_up: userId } : { vote_down: userId }),
      },
      $pull: {
        ...(is_up ? { vote_down: userId } : { vote_up: userId }),
      },
      $inc: {
        vote_up_count: is_up ? 1 : 0,
        vote_down_count: is_up ? 0 : 1,
      },
      $set: {
        updated_at: new Date(),
      },
    };

    const comment = await mongoHistClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("comment").updateOne(filter, payload);

    return comment.modifiedCount != 0 ? true : false;
  } catch (e) {
    return false;
  } finally {
    mongoHistClient.close();
  }
};

/*
exports.editComment = async (_, obj, ctx) => {

  const { userId, permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return {};

  const { comment_id, vote_up, vote_down, title, body } = obj.input;
  const client = await _getMongoLogClient();

  let comment = {};

  if (body && title) {
    let filter = {
      _id: new mongodb.ObjectId(comment_id)
    };

    let payload = {
      $set: {
        title: title,
        body: body
      }
    };

    comment = await client.db('edx_hist').collection('comment').updateOne(filter, payload);
  }

  if (vote_up || vote_down) {
    // If there is vote up or down
    filter = {
      _id: new mongodb.ObjectId(comment_id),
      "votes.up.user_id": { $ne: Number(userId) }
    };

    let data = {};
    if (vote_up) {
      data['votes.up'] = {
        'user_id': Number(userId)
      };
    }
    if (vote_down) {
      data['votes.down'] = {
        'user_id': Number(userId)
      };
    }

    payload = {
      $inc: {
        "votes.up_count": vote_up ? 1 : 0,
        "votes.down_count": vote_down ? 1 : 0
      },
      $push: data
    };

    await client.db('edx_hist').collection('comment').updateOne(filter, payload);
  }

  client.close();
  return comment;
};
*/

exports.deleteComment = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { comment_id } = obj;
  const client = await _getMongoLogClient();

  try {
    await client
      .db(process.env.MONGO_DB_INSPECT_NAME)
      .collection("comment")
      .deleteOne({ _id: new ObjectId(comment_id) });
    return true;
  } catch (e) {
    console.log("[comment delete error]", e);
    return false;
  } finally {
    client.close();
  }
};
