/** @type {import('next').NextConfig} */
const repoBase = "/cys_storefront_kit"; // GitHub Pages project base

module.exports = {
  output: "export",
  basePath: repoBase,
  assetPrefix: repoBase + "/",
  images: { unoptimized: true },
  trailingSlash: true
};