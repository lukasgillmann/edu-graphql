const { _getZeroTime } = require("../common/time");
const { _allowTimeTrack } = require("../common/utility");
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
          file_id,
          topic,
          spent, 
          instructor_name
        }
      ]
    }
  ]
}
*/
exports.editReplayInspect = async (_, obj, ctx) => {
  const { userId, permission, is_ghost } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0 || is_ghost) return false;

  const { course_id, hash, event_id, file_id, topic, spent, instructor_name } = obj.input;

  const mongoClient = await _getMongoLogClient();
  const sqlAppClient = await _getSQLAppClient();

  try {
    if (!(await _allowTimeTrack(sqlAppClient, userId, hash))) return false;

    await this.updateInspectReplay(mongoClient, userId, course_id, event_id, file_id, topic, spent, instructor_name);
    return true;
  } catch (e) {
    console.log("[edit err]", e);
    return false;
  } finally {
    mongoClient.close();
    sqlAppClient.quit();
  }
};

exports.updateInspectReplay = async (mongoClient, userId, courseId, eventId, fileId, topic, spent, instructorName) => {
  const currDate = _getZeroTime(new Date().getTime());

  // Determine whether there is document inside MongoDB
  let res = await mongoClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.replay")
    .aggregate([{ $match: { user_id: userId, course_id: courseId } }, { $project: { _id: "$_id" } }])
    .toArray();

  if (!res || res.length == 0) {
    // If there is no document for this user-course pair, then insert new one
    await mongoClient
      .db(process.env.MONGO_DB_INSPECT_NAME)
      .collection("inspect.replay")
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
                file_id: fileId,
                topic: topic,
                spent: spent,
                instructor_name: instructorName,
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
      .collection("inspect.replay")
      .aggregate([{ $match: { _id: objectId } }, { $unwind: "$data" }, { $match: { "data.date": currDate } }, { $project: { details: "$data.details" } }])
      .toArray();

    if (res && res.length) {
      // if there is item with the required date, then update details level object
      res = res[0]["details"];
      const vimeoIndex = res.findIndex((r) => r.file_id == fileId);
      if (vimeoIndex >= 0) {
        res[vimeoIndex]["spent"] = Math.round(parseFloat(res[vimeoIndex]["spent"]) + spent);
        res[vimeoIndex]["instructor_name"] = instructorName;
      } else {
        res.unshift({
          event_id: eventId,
          file_id: fileId,
          topic: topic,
          spent: spent,
          instructor_name: instructorName,
        });
      }

      res = await mongoClient
        .db(process.env.MONGO_DB_INSPECT_NAME)
        .collection("inspect.replay")
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
        .collection("inspect.replay")
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
                        file_id: fileId,
                        topic: topic,
                        spent: spent,
                        instructor_name: instructorName,
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
