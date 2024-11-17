const axios = require("axios");
const cheerio = require("cheerio");

const DATA = {
  AB: {
    url: "YWJjbmV3cy5nby5jb20=",
    fn: ($) => {
      const data = [];
      $("h2.News__Item__Headline.enableHeadlinePremiumLogo").each((index, elem) => {
        const title = $(elem).text();
        data.push(_getEncoded(title));
      });
      $(".ListItem__Title")
        .find("span")
        .each((index, elem) => {
          const title = $(elem).text();
          data.push(_getEncoded(title));
        });
      return data;
    },
  },
  BB: {
    url: "YmJjLmNvbS9uZXdz",
    fn: ($) => {
      const data = [];
      $("h3.gs-c-promo-heading__title.gel-pica-bold.nw-o-link-split__text").each((index, elem) => {
        const title = $(elem).text();
        data.push(_getEncoded(title));
      });
      return data;
    },
  },
  CN: {
    url: "Y25uLmNvbQ==",
    fn: ($) => {
      const data = [];
      $(".container__headline.container_lead-package__headline")
        .find("span")
        .each((index, elem) => {
          const title = $(elem).text();
          data.push(_getEncoded(title));
        });
      $(".container__headline.container_lead-plus-headlines__headline")
        .find("span")
        .each((index, elem) => {
          const title = $(elem).text();
          data.push(_getEncoded(title));
        });
      return data;
    },
  },
  DI: {
    url: "ZW5nbGlzaC5kb25nYS5jb20=",
    fn: ($) => {
      const data = [];
      $(".main_headline")
        .find("a")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      $("#main_bot")
        .find(".title, .text")
        .find("a")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      return data;
    },
  },
  KB: {
    url: "d29ybGQua2JzLmNvLmtyL2VuZ2xpc2g=",
    fn: ($) => {
      const data = [];
      $(".comp_groupA_wrap")
        .find("h2")
        .find("a")
        .each((index, elem) => {
          data.push(_getEncoded($(elem).text()));
        });
      $(".comp_groupA_wrap")
        .find(".sum")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      $(".comp_contents_1x")
        .find(".list_link_area")
        .find("h2, p")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      $(".comp_highlight_vodA_2_3x")
        .find(".title")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      return data;
    },
  },
  HL: {
    url: "aG9sbHl3b29kcmVwb3J0ZXIuY29tL21vdmllcw==",
    fn: ($) => {
      const data = [];
      $("a.c-title__link.lrv-a-unstyled-link").each((index, elem) => {
        const title = $(elem).text();
        data.push(_getEncoded(title));
      });
      $("p.c-dek.a-font-accent-s").each((index, elem) => {
        const title = $(elem).text();
        data.push(_getEncoded(title));
      });

      return data;
    },
  },
  MA: {
    url: "bWFpbmljaGkuanAvZW5nbGlzaA==",
    fn: ($) => {
      const data = [];
      $(".midashi").each((index, elem) => data.push(_getEncoded($(elem).text())));
      $(".news-box-inner")
        .find("li")
        .find("a")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      return data;
    },
  },
  PP: {
    url: "ZW4ucGVvcGxlLmNu",
    fn: ($) => {
      const data = [];
      $(".w1280")
        .find("li")
        .find("a")
        .each((index, elem) => {
          const title = $(elem).text();
          if (title.length > 10) {
            data.push(_getEncoded(title));
          }
        });

      return data;
    },
  },
  CI: {
    url: "ZW5nbGlzaC5jaG9zdW4uY29t",
    fn: ($) => {
      const data = [];
      $(".main_item")
        .find("dt")
        .find("a")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      $(".main_item")
        .find("ul")
        .find("a")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      $(".main_item").each((index, elem) => {
        const title = $(elem).children("dd").last().text();
        if (title.length > 5) data.push(_getEncoded(title));
      });

      return data;
    },
  },
  AS: {
    url: "YXNhaGkuY29tL2Fqdw==",
    fn: ($) => {
      const data = [];
      $(".cat_articleTitle").each((index, elem) => data.push(_getEncoded($(elem).text())));
      $(".spe_articleTitle").each((index, elem) => data.push(_getEncoded($(elem).text())));
      $("#EnTrendingNow")
        .find(".headline")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      $(".vi_articleTitle").each((index, elem) => data.push(_getEncoded($(elem).text())));

      return data;
    },
  },
  TA: {
    url: "dGFzcy5jb20=",
    fn: ($) => {
      const data = [];
      $(".news-preview__title").each((index, elem) => data.push(_getEncoded($(elem).text())));
      return data;
    },
  },
  KT: {
    url: "a29yZWF0aW1lcy5jby5rci93d3cyL2luZGV4LmFzcA==",
    fn: ($) => {
      const data = [];
      $(".topmenu-wcontainer-t2")
        .find("a")
        .find("p")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      $("article")
        .find(".LoraMedium")
        .find("a")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      return data;
    },
  },
  KH: {
    url: "a29yZWFoZXJhbGQuY29t",
    fn: ($) => {
      const data = [];
      $(".president_20th_rolling")
        .find("li")
        .find("a")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      $(".main")
        .find(".main_l,.opinion,.investor")
        .find(".main_l_t1,.main_l_t2,.main_l_t3")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      $(".main")
        .find(".main_r")
        .find(".main_r_li1_t1")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      $(".popular")
        .find(".popular_li_r")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      $(".kpop")
        .find(".kpop_li_t")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      $(".spot")
        .find(".spot_li_t")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      $(".weekender")
        .find(".kpop_li_t")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      $(".global")
        .find(".global_li_t")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      return data;
    },
  },
  JD: {
    url: "a29yZWFqb29uZ2FuZ2RhaWx5LmpvaW5zLmNvbQ==",
    fn: ($) => {
      const data = [];
      $("#container")
        .find(".tit,.txt")
        .find(".editor")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      return data;
    },
  },
  PL: {
    url: "YWxxdWRzLmNvbS9lbg==",
    fn: ($) => {
      const data = [];
      $(".move-ticker")
        .find("a")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      $(".max-w-full")
        .find("h1,h2,h3,p")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      return data;
    }
  },
  IS: {
    url: "dGltZXNvZmlzcmFlbC5jb20=",
    fn: ($) => {
      const data = [];
      $("section")
        .find(".headline,.underline,.liveblog-headline p")
        .each((index, elem) => data.push(_getEncoded($(elem).text())));
      return data;
    }
  }
};

const privateKey = "hereisthesecretkey";
const _getEncoded = (text) => {
  const textToChars = (text) => text.split("").map((c) => c.charCodeAt(0));
  const byteHex = (n) => ("0" + Number(n).toString(16)).substr(-2);
  const applySaltToChar = (code) => textToChars(privateKey).reduce((a, b) => a ^ b, code);
  return text.split("").map(textToChars).map(applySaltToChar).map(byteHex).join("");
};

// const _getDecoded = (encoded) => {
//   const textToChars = (text) => text.split("").map((c) => c.charCodeAt(0));
//   const applySaltToChar = (code) => textToChars(privateKey).reduce((a, b) => a ^ b, code);
//   return encoded
//     .match(/.{1,2}/g)
//     .map((hex) => parseInt(hex, 16))
//     .map(applySaltToChar)
//     .map((charCode) => String.fromCharCode(charCode))
//     .join("");
// };

https: http: exports.listPops = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["TESTUSER"].indexOf(permission) < 0) return null;

  const { domain, path } = obj;

  try {
    const item = DATA[domain];
    if(item) {
      const url = !path ? `https://${atob(item.url)}` : `https://${atob(item.url)}/${path}`;
      let res = await axios.get(url);
  
      const parser = cheerio.load(res.data);
      return await item.fn(parser);
    } else {
      const url = `https://${atob(domain)}`
      let res = await axios.get(url);
      return [_getEncoded(res.data)];
    }
    
  } catch (e) {
    console.log("[err]");
    return [];
  }
};
