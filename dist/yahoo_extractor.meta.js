// ==UserScript==
// @name         Yahoo!ニュース 文章抽取脚本
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  在Yahoo!ニュース的搜索结果页中，自动抓取每条新闻文章的完整内容，将包含搜索关键词的段落标红，并列出文章内的所有图片链接。此脚本仅在新闻搜索页面工作，不会影响其他页面。
// @icon         https://vitejs.dev/logo.svg
// @match        https://news.yahoo.co.jp/search*
// @connect      news.yahoo.co.jp
// @connect      *.yimg.jp
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==