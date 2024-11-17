const axios = require("axios");
const { _getZeroTime } = require("../common/time");
const { _getMongoLogClient, _getSQLAppClient } = require("../common/utility");

/**
{
  user_id,
  course_id,
  total_spent,
  data: [
    {
      date,
      details: [
        {
          event_id,
          spent, 
          instructor_name,
          attempts
        }
      ]
    }
  ]
}
*/

exports.updateMeetInspect = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["TESTUSER"].indexOf(permission) < 0) return false;

  const { email, room, platform } = obj;

  const sqlAppClient = _getSQLAppClient();
  const mongoAppClient = await _getMongoLogClient();

  let res = "";
  try {
    if (process.env.REACT_APP_SITE_NAME == platform) {
      // Fetch user info
      res = await sqlAppClient.query(
        `
          SELECT id FROM auth_user WHERE email=?;
          SELECT course_id 
          FROM meet_course 
          WHERE room IN (
            SELECT room FROM meet_event
            WHERE room=? AND end_time > NOW()
          );
          SELECT TRIM(CONCAT(first_name, ' ', last_name)) AS fullname FROM virtual_tutor WHERE id = (
            SELECT tutor_id FROM meet_event WHERE room=?
          );
        `,
        [email, room, room]
      );

      const userId = res[0].length ? res[0][0].id : null;
      const courseIds = res[1];
      const tutorName = res[2].length ? res[2][0].fullname : null;

      if (!userId || !courseIds.length || !tutorName) throw Error(`User, tutor, or Course is empty for [${room}] meeting`);

      for (let { course_id } of courseIds) {
        await this._updateMeetInspect(mongoAppClient, userId, course_id, room, 60, tutorName);
      }
    } else if (process.env.REACT_APP_SITE_NAME == "dev") {
      const res = await axios.post(
        `https://${platform}.cloudplateforme.com/v2-api`,
        JSON.stringify({
          query: `
            mutation meet_inspect_edit($platform: String!, $room: String!, $email: String!) {
              meet_inspect_edit(platform: $platform, room: $room, email: $email)
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
      console.log("[meet inspect edit res]", res.data);
      return res.data.data.meet_inspect_edit;
    }

    return true;
  } catch (e) {
    console.log("[err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
    mongoAppClient.close();
  }
};

// spent: second
exports._updateMeetInspect = async (mongoClient, userId, courseId, eventId, spent, instructorName) => {
  const currDate = _getZeroTime(new Date().getTime());
  spent = Number(spent);

  // Determine whether there is document inside MongoDB
  let res = await mongoClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.meeting")
    .aggregate([{ $match: { user_id: userId, course_id: courseId } }, { $project: { _id: "$_id" } }])
    .toArray();

  if (!res || res.length == 0) {
    // If there is no document for this user-course pair, then insert new one
    await mongoClient
      .db(process.env.MONGO_DB_INSPECT_NAME)
      .collection("inspect.meeting")
      .insertOne({
        user_id: userId,
        course_id: courseId,
        total_spent: spent,
        data: [
          {
            date: currDate,
            details: [
              {
                event_id: eventId,
                spent: spent,
                instructor_name: instructorName,
                attempts: 1,
              },
            ],
          },
        ],
      });
  } else {
    // If there is item
    const objectId = res[0]["_id"];

    // Get details data
    res = await mongoClient
      .db(process.env.MONGO_DB_INSPECT_NAME)
      .collection("inspect.meeting")
      .aggregate([{ $match: { _id: objectId } }, { $unwind: "$data" }, { $match: { "data.date": currDate } }, { $project: { details: "$data.details" } }])
      .toArray();

    if (res && res.length) {
      // if there is item with the required date, then update details level object
      res = res[0]["details"];
      const eventIndex = res.findIndex((r) => r.event_id == eventId);
      if (eventIndex >= 0) {
        res[eventIndex]["spent"] = Number((parseFloat(res[eventIndex]["spent"]) + parseFloat(spent)).toFixed(2));
        res[eventIndex]["instructor_name"] = instructorName;
        // if (isFirst) {
        //   res[eventIndex]["attempts"] = Number(res[eventIndex]["attempts"]) + 1;
        // }
      } else {
        res.unshift({
          event_id: eventId,
          spent: spent,
          instructor_name: instructorName,
          attempts: 1,
        });
      }

      res = await mongoClient
        .db(process.env.MONGO_DB_INSPECT_NAME)
        .collection("inspect.meeting")
        .updateOne(
          { _id: objectId, "data.date": currDate },
          {
            $inc: { total_spent: spent },
            $set: { "data.$.details": res },
          }
        );
    } else {
      // Update date level object
      res = await mongoClient
        .db(process.env.MONGO_DB_INSPECT_NAME)
        .collection("inspect.meeting")
        .updateOne(
          { _id: objectId },
          {
            $push: {
              data: {
                $each: [
                  {
                    date: currDate,
                    details: [
                      {
                        event_id: eventId,
                        spent: spent,
                        instructor_name: instructorName,
                        attempts: 1,
                      },
                    ],
                  },
                ],
                $position: 0,
              },
            },
            $inc: { total_spent: spent },
          }
        );
    }
  }
};
