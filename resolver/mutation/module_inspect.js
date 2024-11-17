const { _getZeroTime } = require("../common/time");
const { _allowTimeTrack } = require("../common/utility");
const { _getMongoLogClient, _getSQLAppClient } = require("../common/utility");

/**
{
  user_id,
  course_id,
  total_spent,
  quiz_spent,
  data: [
    {
      date,
      details: [
        {
          module_title,
          total_spent, // second
          quiz_spent,  // second
          correct_count,
          total_count
        }
      ]
    }
  ]
}
*/
exports.editInspectModule = async (_, obj, ctx) => {
  const { userId, permission, is_ghost } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0 || is_ghost) return false;

  const { course_id, hash, module_title, total_spent, quiz_spent, correct_count, total_count, progress } = obj.input;
  const currDate = _getZeroTime(new Date().getTime());

  const mongoClient = await _getMongoLogClient();
  const sqlAppClient = await _getSQLAppClient();

  let res = "";

  try {
    if (!(await _allowTimeTrack(sqlAppClient, userId, hash))) return false;

    if (progress) {
      await sqlAppClient.query(`UPDATE student_courseenrollment SET progress=${Math.min(progress, 100)} WHERE course_id='${course_id}' AND user_id=${userId};`);
    }

    // Determine whether there is document inside MongoDB
    res = await mongoClient
      .db(process.env.MONGO_DB_INSPECT_NAME)
      .collection("inspect.module")
      .aggregate([{ $match: { user_id: userId, course_id: course_id } }, { $project: { _id: "$_id" } }])
      .toArray();

    if (!res || res.length == 0) {
      // If there is no document for this user-course pair, then insert new one
      await mongoClient
        .db(process.env.MONGO_DB_INSPECT_NAME)
        .collection("inspect.module")
        .insertOne({
          user_id: userId,
          course_id: course_id,
          total_spent: total_spent,
          quiz_spent: quiz_spent,
          data: [
            {
              date: currDate,
              details: [
                {
                  module_title: module_title,
                  total_spent: total_spent,
                  quiz_spent: quiz_spent,
                  correct_count: correct_count,
                  total_count: total_count,
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
        .collection("inspect.module")
        .aggregate([{ $match: { _id: objectId } }, { $unwind: "$data" }, { $match: { "data.date": currDate } }, { $project: { details: "$data.details" } }])
        .toArray();

      if (res && res.length) {
        // if there is item with the required date, then update details level object
        res = res[0]["details"];
        const moduleIndex = res.findIndex((r) => r.module_title == module_title);
        if (moduleIndex >= 0) {
          res[moduleIndex]["total_spent"] = Math.round((res[moduleIndex]["total_spent"] + total_spent) * 100) / 100;
          res[moduleIndex]["quiz_spent"] = Math.round((res[moduleIndex]["quiz_spent"] + quiz_spent) * 100) / 100;
          res[moduleIndex]["correct_count"] = correct_count;
          res[moduleIndex]["total_count"] = total_count;
        } else {
          res.unshift({
            module_title: module_title,
            total_spent: total_spent,
            quiz_spent: quiz_spent,
            correct_count: correct_count,
            total_count: total_count,
          });
        }

        res = await mongoClient
          .db(process.env.MONGO_DB_INSPECT_NAME)
          .collection("inspect.module")
          .updateOne(
            { _id: objectId, "data.date": currDate },
            {
              $inc: { total_spent: total_spent, quiz_spent: quiz_spent },
              $set: { "data.$.details": res },
            }
          );
      } else {
        // Update date level object
        res = await mongoClient
          .db(process.env.MONGO_DB_INSPECT_NAME)
          .collection("inspect.module")
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
                          module_title: module_title,
                          total_spent: total_spent,
                          quiz_spent: quiz_spent,
                          correct_count: correct_count,
                          total_count: total_count,
                        },
                      ],
                    },
                  ],
                  $position: 0,
                },
              },
              $inc: { total_spent: total_spent, quiz_spent: quiz_spent },
            }
          );
      }
    }

    return true;
  } catch (e) {
    console.log("[edit err]", e);

    return false;
  } finally {
    mongoClient.close();
    sqlAppClient.quit();
  }
};

exports.modifyModuleDBStructure = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return false;

  const mongoClient = await _getMongoLogClient();

  let res = "",
    ids = [];

  try {
    res = await mongoClient
      .db(process.env.MONGO_DB_INSPECT_NAME)
      .collection("inspect.module")
      .aggregate([{ $project: { _id: 1 } }])
      .toArray();

    ids = res.map((v) => v._id);

    for (let objectId of ids) {
      let objItem = await mongoClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("inspect.module").find({ _id: objectId }).toArray();

      if (!objItem.length) continue;

      objItem = JSON.parse(JSON.stringify(objItem[0]));

      let totalSpent = 0,
        quizSpent = 0;
      for (let i = 0; i < objItem.data.length; i++) {
        const dataItem = objItem.data[i];
        for (let j = 0; j < dataItem.details.length; j++) {
          const detailItem = dataItem.details[j];

          detailItem.total_spent = parseFloat(detailItem.total_spent);
          detailItem.quiz_spent = parseFloat(detailItem.quiz_spent) || 0;

          totalSpent += detailItem.total_spent;
          quizSpent += detailItem.quiz_spent;

          objItem.data[i].details[j] = detailItem;
        }
      }

      objItem.total_spent = totalSpent;
      objItem.quiz_spent = quizSpent;
      delete objItem._id;

      res = await mongoClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("inspect.module").updateOne({ _id: objectId }, { $set: objItem });
    }

    ////////////////////////// Replay ///////////////////////////
    res = await mongoClient
      .db(process.env.MONGO_DB_INSPECT_NAME)
      .collection("inspect.replay")
      .aggregate([{ $project: { _id: 1 } }])
      .toArray();

    ids = res.map((v) => v._id);

    for (let objectId of ids) {
      let objItem = await mongoClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("inspect.replay").find({ _id: objectId }).toArray();

      if (!objItem.length) continue;

      objItem = JSON.parse(JSON.stringify(objItem[0]));

      let totalSpent = 0;
      for (let i = 0; i < objItem.data.length; i++) {
        const dataItem = objItem.data[i];
        for (let j = 0; j < dataItem.details.length; j++) {
          const detailItem = dataItem.details[j];

          detailItem.spent = Number(detailItem.spent);
          totalSpent += detailItem.spent;

          objItem.data[i].details[j] = detailItem;
        }
      }

      objItem.total_spent = totalSpent;
      delete objItem._id;

      res = await mongoClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("inspect.replay").updateOne({ _id: objectId }, { $set: objItem });
    }

    return true;
  } catch (e) {
    console.log("[edit err]", e);
    return false;
  } finally {
    mongoClient.close();
  }
};
