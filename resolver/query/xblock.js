const ObjectId = require("mongodb").ObjectId;

exports._listXBlock = async (mongoAppClient, definitionIds) => {
  const defIds = definitionIds.map((d) => ObjectId(d));

  // Attach definitions to the blocks
  const defBlocks = await mongoAppClient
    .db(process.env.MONGO_DB_MAIN_NAME)
    .collection("modulestore.definitions")
    .find({ _id: { $in: defIds } })
    .toArray();

  let xblocks = [];
  for (let defId of definitionIds) {
    const definitionIndex = defBlocks.findIndex((d) => d._id.toString() == defId);
    if (defBlocks[definitionIndex]["block_type"] == "scorm") {
      xblocks.push({
        definition_id: defId,
        html: defBlocks[definitionIndex]["fields"]["package_meta"] ? defBlocks[definitionIndex]["fields"]["package_meta"]["sha1"] : "",
      });
    } else {
      xblocks.push({
        definition_id: defId,
        html: defBlocks[definitionIndex]["fields"]["data"],
      });
    }
  }

  return xblocks;
};
