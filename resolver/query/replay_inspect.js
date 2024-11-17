const { _getMongoLogClient, DEFAULT_OUTPUT } = require("../common/utility");

exports._listReplayInspect = async (mongoHistClient, userId, courseId, page = 0, pageSize = DEFAULT_OUTPUT.page_size) => {
  const filterBody = [
    { $match: { user_id: userId, course_id: courseId } },
    { $unwind: "$data" },
    {
      $project: {
        total_spent: 1,
        date: "$data.date",
        details: "$data.details",
      },
    },
    { $unwind: "$details" },
  ];

  const proData = mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.replay")
    .aggregate([
      ...filterBody,
      {
        $group: {
          _id: "$_id",
          total_spent: { $first: "$total_spent" },
          data: {
            $push: {
              date: "$date",
              details: "$details",
            },
          },
        },
      },
    ])
    .toArray();

  const proTotal = mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("comment")
    .aggregate([...filterBody, { $group: { _id: null, count: { $sum: 1 } } }])
    .toArray();

  let [dbData, totalCount] = await Promise.all([proData, proTotal]);
  totalCount = totalCount.length ? totalCount[0].count : 0;

  let hists = {
    total: totalCount,
    page: page,
    page_size: pageSize,
    data: [],
    ...(dbData.length ? dbData[0] : {}),
  };

  return hists;
};

exports.listReplayInspect = async (_, obj, ctx) => {
  const { userId, permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const { course_id, per_page, page } = obj;

  const mongoClient = await _getMongoLogClient();
  try {
    return await this._listReplayInspect(mongoClient, userId, course_id, page, per_page);
  } catch (e) {
    console.log("[replay inspect list error]", e);
    return null;
  } finally {
    mongoClient.close();
  }
};
