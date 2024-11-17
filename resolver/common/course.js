const { _getMongoAppClient } = require("./utility");
// Return [{ sectionTitle: "...", "gradeFormat": "Quiz"}, ...]
function getModuleToGradeMapper(course) {
  const mapper = [];
  const sections = course.blocks.filter((b) => b.block_type == "chapter");
  for (let section of sections) {
    const sequentialIds = section.fields.children.map((c) => c[1]);
    const sequences = sequentialIds.map((id) => course.blocks.find((b) => b.block_type == "sequential" && b.block_id == id));
    for (let sequence of sequences) {
      if (sequence["fields"]["format"] && sequence["fields"]["graded"]) {
        mapper.push({
          sectionTitle: section.fields["display_name"],
          gradeFormat: sequence.fields["format"],
        });
        break;
      }
    }
  }
  return mapper;
}
function mapChapterToChildBlockIds(course) {
  let childIds = [];
  const sections = course.blocks.filter((b) => b.block_type == "chapter");
  for (let section of sections) {
    let ids = [];
    const sequentialIds = section.fields.children.map((c) => c[1]);
    const sequences = sequentialIds.map((id) => course.blocks.find((b) => b.block_type == "sequential" && b.block_id == id));
    for (let sequence of sequences) {
      const verticalIds = sequence.fields.children.map((c) => c[1]);
      const verticals = verticalIds.map((id) => course.blocks.find((b) => b.block_type == "vertical" && b.block_id == id));
      for (let vertical of verticals) {
        const moduleIds = vertical.fields.children.map((c) => c[1]);
        for (let moduleId of moduleIds) {
          ids.push(moduleId);
        }
      }
    }
    childIds.push({
      section_title: section.fields.display_name,
      childBlockIds: ids,
    });
  }
  return { childIds: childIds, numberOfSections: sections.length };
}

/**
 * {
 *    policies: {
 *      id
 *      title
 *      policy
 *      childIds
 *      numberOfSections
 *    }
 *    moduleMapper: [
 *      {
 *        courseTitle
 *        mapper: {
 *          sectionTitle
 *          gradeFormat: "Quiz"
 *        }
 *      },
 *      ...
 *    ]
 *  }
 */
exports.listGradePolicy = async (ids) => {
  const mongoClient = await _getMongoAppClient();
  let m_ids = ids.map((id) => this._courseId2Wiki(id));
  let versions = await mongoClient
    .db(process.env.MONGO_DB_MAIN_NAME)
    .collection("modulestore.active_versions")
    .find({ "search_targets.wiki_slug": { $in: m_ids } })
    .sort({ _id: -1 })
    .toArray();
  m_ids = versions.map((v) => ({ version: v["versions"]["published-branch"], target: v["search_targets"]["wiki_slug"] }));
  m_ids = m_ids.filter((m, pos) => m_ids.findIndex((mm) => mm.target == m.target) == pos);
  m_ids = m_ids.map((m) => m.version);
  let coursesForGrade = await mongoClient
    .db(process.env.MONGO_DB_MAIN_NAME)
    .collection("modulestore.structures")
    .aggregate([
      {
        $match: {
          _id: { $in: m_ids },
        },
      },
      {
        $project: {
          display_name: { $arrayElemAt: ["$blocks.fields.display_name", 0] },
          "blocks.fields": 1,
          "blocks.definition": 1,
          "blocks.block_type": 1,
          "blocks.block_id": 1,
        },
      },
      {
        $group: {
          _id: "$display_name",
          blocks: { $last: "$blocks" },
        },
      },
    ])
    .toArray();
  if (coursesForGrade && coursesForGrade.length) {
    // Map each module to it's grade format
    let moduleToGradeMapper = [];
    coursesForGrade.forEach((course) => {
      moduleToGradeMapper.push({ courseTitle: course._id, mapper: getModuleToGradeMapper(course) });
    });
    // Map title and grade definition ID
    const defs = coursesForGrade.map((g) => {
      return {
        title: g._id,
        defId: g.blocks.find((b) => b.block_type == "course").definition, // Course definition id
      };
    });
    let gradePolicies = await mongoClient
      .db(process.env.MONGO_DB_MAIN_NAME)
      .collection("modulestore.definitions")
      .find({ _id: { $in: defs.map((d) => d.defId) } })
      .toArray();
    mongoClient.close();
    if (gradePolicies && gradePolicies.length) {
      return {
        policies: gradePolicies.map((g) => {
          const courseTitle = defs.find((d) => d.defId.toString() == g._id.toString()).title;
          const { childIds, numberOfSections } = mapChapterToChildBlockIds(coursesForGrade.find((c) => c._id == courseTitle));
          return {
            id: g._id,
            title: courseTitle,
            policy: g.fields.grading_policy,
            childIds: childIds,
            numberOfSections: numberOfSections,
          };
        }),
        moduleMapper: moduleToGradeMapper,
      };
    }
  }
  mongoClient.close();
  return { policies: [], moduleMapper: [] };
};

exports._courseId2Wiki = (courseId) => {
  if (!courseId) return "";
  const arr = courseId.split(":");
  if (arr[0] != "course-v1" || arr.length < 2) return "";
  const idBody = arr[1];
  return idBody.replace(/\+/g, ".");
};
