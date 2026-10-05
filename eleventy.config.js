import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { feedPlugin } from "@11ty/eleventy-plugin-rss";

const site = JSON.parse(readFileSync("./src/_data/site.json", "utf8"));

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/assets/img");
  eleventyConfig.addPassthroughCopy({ "src/assets/img/favicon.svg": "favicon.svg" });
  eleventyConfig.addWatchTarget("src/assets/css/");

  // Tailwind runs after every Eleventy build, so `npm run dev` is one process.
  eleventyConfig.on("eleventy.after", ({ runMode }) => {
    const minify = runMode === "build" ? " --minify" : "";
    execSync(
      `npx tailwindcss -i src/assets/css/main.css -o _site/assets/css/main.css${minify}`,
      { stdio: "inherit" }
    );
  });

  eleventyConfig.addFilter("readableDate", (date) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    }).format(date)
  );
  eleventyConfig.addFilter("isoDate", (date) => date.toISOString().slice(0, 10));
  // Emails go out as HTML entities so naive scrapers matching "x@y.z" miss them.
  // No JS allowed (CSP script-src 'none'), so this is the strongest option left.
  eleventyConfig.addFilter("obfuscate", (text) =>
    [...String(text)].map((c) => `&#${c.codePointAt(0)};`).join("")
  );

  eleventyConfig.addPlugin(feedPlugin, {
    type: "atom",
    outputPath: "/feed.xml",
    collection: { name: "posts", limit: 20 },
    metadata: {
      language: "en-GB",
      title: `${site.name}'s blog`,
      subtitle: site.description,
      base: site.url,
      author: { name: site.name },
    },
  });

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
