const { _getMongoLogClient, DEFAULT_OUTPUT } = require("../common/utility");

exports._listMeetingInspect = async (mongoHistClient, userId, courseId = null, page = 0, pageSize = DEFAULT_OUTPUT.page_size) => {
  const filterBody = [
    { $match: { user_id: userId, ...(courseId ? { course_id: courseId } : {}) } },
    { $unwind: "$data" },
    {
      $project: {
        total_spent: 1,
        course_id: "$course_id",
        date: "$data.date",
        details: "$data.details",
      },
    },
    { $unwind: "$details" },
  ];

  const proData = mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.meeting")
    .aggregate([
      ...filterBody,
      { $skip: pageSize * page },
      { $limit: pageSize },
      {
        $group: {
          _id: "$_id",
          total_spent: { $first: "$total_spent" },
          data: {
            $push: {
              course_id: "$course_id",
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
    .collection("inspect.meeting")
    .aggregate([...filterBody, { $group: { _id: null, count: { $sum: 1 } } }])
    .toArray();

  let [dbData, totalCount] = await Promise.all([proData, proTotal]);
  totalCount = totalCount.length ? totalCount[0].count : 0;

  let joinedData = {};
  for (let item of dbData) {
    joinedData = {
      _id: item._id,
      total_spent: (joinedData.total_spent || 0) + item.total_spent,
      data: [...(joinedData.data || []), ...item.data],
    };
  }

  let hists = {
    total: totalCount,
    page: page,
    page_size: pageSize,
    data: [],
    ...joinedData,
  };

  return hists;
};

exports.listMeetingInspect = async (_, obj, ctx) => {
  const { userId, permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const { course_id, per_page, page } = obj;

  const mongoClient = await _getMongoLogClient();
  try {
    return await this._listMeetingInspect(mongoClient, userId, course_id, page, per_page);
  } catch (e) {
    console.log("[event inspect list error]", e);
    return null;
  } finally {
    mongoClient.close();
  }
};
