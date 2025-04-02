import { parentPort, workerData } from 'worker_threads';
import logger from './logger';
import * as fs from 'fs';
import { EPub, EpubOptions, EpubContentOptions } from '@lesjoursfr/html-to-epub';
import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import * as path from 'path';

import { NodeWorkerResponse, NwrEnum } from './service';

var port = parentPort;
if (!port) throw new Error('IllegalState');

// epub文件名
var title: string = workerData.title;
// 数据来源文件夹
var epubDataPath: string = workerData.epubDataPath;
// 封面图片
var epubCover: string = workerData.epubCover && workerData.epubCover.length > 0 ? workerData.epubCover : undefined;
// 缓存路径
var tmpPath: string = workerData.tmpPath;

// 接收消息，执行任务
port.on('message', async (message: NodeWorkerResponse) => {
  if (message.code == NwrEnum.START) {
    resp(NwrEnum.SUCCESS, '正在生成Epub，开始获取文章...');

    var limitCount = 666;
    // 遍历文件夹，获取文章
    var htmlArr: string[] = [];
    listHtmlFile(epubDataPath, htmlArr, 0);
    resp(NwrEnum.SUCCESS, `已获取到${htmlArr.length}篇文章，开始转换...`);

    // 生成Epub
    if (htmlArr.length > 0) {
      if (htmlArr.length > limitCount) {
        resp(NwrEnum.SUCCESS, `文章数量超出限制，只转换${limitCount}篇文章`);
        htmlArr.length = limitCount;
      }

      var epubItemArr: EpubContentOptions[] = [];
      for (var htmlPath of htmlArr) {
        var itemData = await getEpubItemData(htmlPath);
        epubItemArr.push(itemData);
        resp(NwrEnum.SUCCESS, `【${itemData.title}】转换完成`);
      }

      resp(NwrEnum.SUCCESS, '开始创建Epub');

      var option: EpubOptions = {
        title: title,
        description: 'created by wechatDownload',
        tocTitle: '目录',
        author: 'Nobody',
        tempDir: tmpPath,
        cover: epubCover,
        content: epubItemArr
      };

      var savePath = path.join(epubDataPath, title + '.epub');
      var epub = new EPub(option, savePath);

      epub
        .render()
        .then(() => {
          resp(NwrEnum.SUCCESS, `Epub创建成功，存放位置：${savePath}`);
          resp(NwrEnum.CLOSE, '');
        })
        .catch((err) => {
          console.error('Epub创建失败', err);
          resp(NwrEnum.SUCCESS, 'Epub创建失败');
          resp(NwrEnum.CLOSE, '');
        });
    }
  }
});

port.on('close', () => {
  logger.info('on 线程关闭');
});

port.addListener('close', () => {
  logger.info('addListener 线程关闭');
});

/**
 * 递归文件夹获取html文件
 * @param dirPath 文件夹路径
 * @param htmlArr 存放html文件的数组
 * @param inLevel 递归层级
 */
function listHtmlFile(dirPath: string, htmlArr: string[], inLevel: number) {
  var files = fs.readdirSync(dirPath);
  files.forEach((file) => {
    var filePath = path.join(dirPath, file);
    var stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      if (inLevel < 3) {
        listHtmlFile(filePath, htmlArr, inLevel + 1);
      }
    } else {
      if (filePath.endsWith('.html')) {
        htmlArr.push(filePath);
      }
    }
  });
}

/**
 * 将html文件转成epub数据
 * @param htmlPath html文件路径
 */
async function getEpubItemData(htmlPath: string): Promise<EpubContentOptions> {
  var htmlStr = fs.readFileSync(htmlPath, 'utf8');
  var dom = new JSDOM(htmlStr, { runScripts: 'dangerously' });
  // 等待页面渲染完成
  await new Promise((resolve, reject) => {
    dom.window.addEventListener('load', () => {
      resolve('ok');
    });

    setTimeout(() => {
      reject();
    }, 2000);
  });

  var folderPath = path.dirname(htmlPath);
  // 处理html内容，删除标题和js，将相对路径图片转成绝对路径
  var $ = cheerio.load(dom.serialize());
  $('script').remove();
  $('h1').remove();
  var srcArr = $('[src]');
  for (let i = 0; i < srcArr.length; i++) {
    var $ele = $(srcArr[i]);
    var src = $ele.attr('src');
    if (src && src.length > 0) {
      if (!src.startsWith('http')) {
        // 获取相对路径
        $ele.attr('src', 'file://' + path.resolve(folderPath, src));
      }
    }
  }

  var title = path.basename(folderPath);

  return {
    title: title,
    data: $.xml()
  };
}

function resp(code: NwrEnum, message: string, data?) {
  logger.info('resp', code, message, data);
  port!.postMessage(new NodeWorkerResponse(code, message, data));
}
