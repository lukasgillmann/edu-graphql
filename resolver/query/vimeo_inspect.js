const { _getMongoLogClient } = require("../common/utility");

exports._getInspectVimeo = async (mongoHistClient, userId, courseId, vimeoId) => {
  const hists = await mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.vimeo")
    .aggregate([{ $match: { user_id: userId, course_id: courseId } }, { $unwind: "$data" }, { $match: { "data.vimeo_id": vimeoId } }])
    .toArray();

  let res = { vimeo_id: vimeoId, seek: 0 };
  if (hists && hists.length && hists[0]["data"]) {
    res["seek"] = hists[0]["data"]["seek"];
  }

  return res;
};

exports.getInspectVimeo = async (_, obj, ctx) => {
  const { userId, permission } = ctx;
  const { course_id, vimeo_id } = obj;

  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return { vimeo_id: vimeo_id, seek: 0 };

  const mongoClient = await _getMongoLogClient();

  try {
    return await this._getInspectVimeo(mongoClient, userId, course_id, vimeo_id);
  } catch (e) {
    console.log("[mongoerror]", e);

    return { vimeo_id: vimeo_id, seek: 0 };
  } finally {
    mongoClient.close();
  }
};

exports.listInspectVimeo = async (_, obj, ctx) => {
  const { userId, permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const { course_id, per_page, page } = obj;

  const mongoClient = await _getMongoLogClient();

  try {
    const filter = course_id ? { user_id: userId, course_id: course_id } : { user_id: userId };

    let hists = await mongoClient
      .db(process.env.MONGO_DB_INSPECT_NAME)
      .collection("inspect.vimeo")
      .aggregate([
        { $match: filter },
        { $unwind: "$data" },
        {
          $facet: {
            data: [{ $skip: per_page * page }, { $limit: per_page }],
            totalCount: [{ $count: "count" }],
          },
        },
      ])
      .toArray();

    if (hists && hists.length) {
      hists = hists[0];
      if (hists["totalCount"] && hists["totalCount"].length) {
        hists["total"] = hists["totalCount"][0]["count"];
      }
      hists.data = hists.data.map((d) => d.data);
    }

    return hists;
  } catch (e) {
    console.log("[mongoerror]", e);
    return null;
  } finally {
    mongoClient.close();
  }
};
