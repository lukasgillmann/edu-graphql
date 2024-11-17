const { _getMongoLogClient } = require("../common/utility");

exports.editInspectVimeo = async (_, obj, ctx) => {
  const { userId, permission, is_ghost } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0 || is_ghost) return false;

  const { course_id, vimeo_id, module_title, vimeo_title, seek, duration, spent } = obj.input;

  const mongoClient = await _getMongoLogClient();

  try {
    // Determine whether there is document inside MongoDB
    let res = await mongoClient
      .db(process.env.MONGO_DB_INSPECT_NAME)
      .collection("inspect.vimeo")
      .aggregate([{ $match: { user_id: userId, course_id: course_id } }, { $project: { _id: "$_id" } }])
      .toArray();

    if (!res || res.length == 0) {
      // If there is no document for this user-course pair, then insert new one
      await mongoClient
        .db(process.env.MONGO_DB_INSPECT_NAME)
        .collection("inspect.vimeo")
        .insertOne({
          user_id: userId,
          course_id: course_id,
          data: [
            {
              vimeo_id: vimeo_id,
              module_title: module_title,
              vimeo_title: vimeo_title,
              seek: seek,
              duration: duration,
              spent: spent,
            },
          ],
        });
    } else {
      // If there is item
      const objectId = res[0]["_id"];

      // Get details data
      res = await mongoClient
        .db(process.env.MONGO_DB_INSPECT_NAME)
        .collection("inspect.vimeo")
        .aggregate([{ $match: { _id: objectId } }, { $unwind: "$data" }, { $match: { "data.vimeo_id": vimeo_id } }])
        .toArray();

      if (res && res.length) {
        // if there is item with the required date, then update details level object
        res = res[0]["data"];

        res["module_title"] = module_title;
        res["vimeo_title"] = vimeo_title;
        res["seek"] = seek;
        res["duration"] = duration;
        res["spent"] = (parseFloat(res["spent"]) + parseFloat(spent)).toFixed(3);

        res = await mongoClient
          .db(process.env.MONGO_DB_INSPECT_NAME)
          .collection("inspect.vimeo")
          .updateOne({ _id: objectId, "data.vimeo_id": vimeo_id }, { $set: { "data.$": res } });
      } else {
        // Update date level object
        res = await mongoClient
          .db(process.env.MONGO_DB_INSPECT_NAME)
          .collection("inspect.vimeo")
          .updateOne(
            { _id: objectId },
            {
              $push: {
                data: {
                  vimeo_id: vimeo_id,
                  module_title: module_title,
                  vimeo_title: vimeo_title,
                  seek: seek,
                  duration: duration,
                  spent: spent,
                },
              },
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
  }
};
