const { _upload2DevS3 } = require("../common/aws");

const envContent = `NODE_ENV='production'

`;

exports.editPlatform = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN"].indexOf(permission) < 0) return false;

  const { site_name, site_display_name, admin_email, gql_version, env } = obj;

  let path = "";
  let baseDomain = "";
  if (env === "Development") {
    path = `dev/.env.${site_name}.coffee`;
    baseDomain = "dev.cloudplateform.com";
  } else if (env === "Production") {
    path = `prod/.env.${site_name}.coffee`;
    baseDomain = "cloudplateforme.com";
  } else {
    path = `customers/.env.${site_name}.coffee`;
    baseDomain = "dev.cloudplateform.com";
  }

  try {
    let template = envContent;
    template = template.replace(/VAR_SITE_NAME/g, site_name);
    template = template.replace(/VAR_SITE_DISPLAY_NAME/g, site_display_name);
    template = template.replace(/VAR_BASE_DOMAIN/g, baseDomain);
    template = template.replace(/VAR_ADMIN_EMAIL/g, admin_email);
    template = template.replace(/VAR_GQL_VERSION/g, gql_version);

    await _upload2DevS3(process.env.REACT_APP_S3_DEV_BUCKET_NAME, path, template);

    return true;
  } catch (e) {
    console.log("[Edit theme Err]", e);
    return false;
  }
};
