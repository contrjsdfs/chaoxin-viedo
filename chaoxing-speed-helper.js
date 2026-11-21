/**
 * 学习通视频辅助脚本 - 多任务点版
 * 功能：
 *   1) 锁定 1.5x/2x 倍速（你自己控制节奏）
 *   2) 本节有多个视频时，依次自动播放，全部看完才进入下一节
 *   3) 视频正常播完自动点「下一节」
 * 边界：不改静音、不伪装可见、不伪造记录；请确实在观看
 *
 * 控制台命令：
 *   changeSpeed(1.5)  切倍速
 *   toggleAutoNext()  开/关自动下一节
 *   stopHelper()      停止
 *   diagFrames()      打印框架/视频诊断
 */
(() => {
  'use strict';

  let currentSpeed = 2;
  let autoNext = true;
  const nextDelay = 1500;
  const finishedSrc = new Set();   // 已播完的视频 src（按 src 记，适配"同一元素换源"）
  let advancing = false;           // 防止重复触发跳节
  let timer = null;

  const log = (...a) => console.log('%c[学习助手]', 'color:#2a7;font-weight:bold', ...a);

  // 递归收集所有可访问的 document（跨域的跳过并计数）
  let blockedCount = 0;
  function walk(doc, path, out, depth) {
    if (depth > 8) return;
    out.push({ doc, path });
    let frames;
    try { frames = doc.querySelectorAll('iframe'); } catch (e) { return; }
    Array.from(frames).forEach((f, i) => {
      try {
        const cd = f.contentDocument;
        if (cd) walk(cd, path + ' > iframe[' + i + ']', out, depth + 1);
        else blockedCount++;
      } catch (e) { blockedCount++; }
    });
  }
  function allFrames() {
    blockedCount = 0;
    const out = [];
    walk(document, 'top', out, 0);
    return out;
  }
  function allVideos(frames) {
    const out = [];
    frames.forEach(({ doc, path }) => {
      let vs;
      try { vs = doc.querySelectorAll('video'); } catch (e) { return; }
      vs.forEach(v => out.push({ v, path }));
    });
    return out;
  }
  function srcOf(v) {
    try { return v.currentSrc || v.src || ''; } catch (e) { return ''; }
  }
  function isFinished(v) {
    const s = srcOf(v);
    if (s && finishedSrc.has(s)) return true;
    try { if (v.ended) return true; } catch (e) {}
    try { if (v.duration && v.currentTime >= v.duration - 1.5) return true; } catch (e) {}
    return false;
  }

  function findNextButton(frames) {
    const re = /^(下一节|下一集|下一段|下一个|下一章节|继续学习|播放下一节|继续播放)/;
    for (const { doc } of frames) {
      let els;
      try { els = doc.querySelectorAll('a,button,span,div,li,[class*=next],[id*=next]'); }
      catch (e) { continue; }
      for (const el of els) {
        const t = (el.innerText || el.textContent || '').trim();
        if (t && t.length <= 12 && re.test(t)) return el;
      }
    }
    return null;
  }

  function goNext(btn) {
    try {
      allFrames().forEach(function (f) {
        try {
          var w = f.doc.defaultView;
          if (w && typeof w.closeDeleteWindow !== 'function') w.closeDeleteWindow = function () {};
        } catch (e) {}
      });
    } catch (e) {}
    try { btn.click(); return; } catch (e) { log('click 失败：', e.message); }
    try {
      var h = btn.getAttribute('href') || '';
      if (/^javascript:/i.test(h)) {
        btn.ownerDocument.defaultView.eval(h.replace(/^javascript:/i, ''));
        log('已执行 href 脚本');
      }
    } catch (e) {}
  }

  function tryAutoPlay(v, label) {
    if (!v || isFinished(v)) return;
    try { if (!v.paused) return; } catch (e) { return; }
    try {
      v.playbackRate = currentSpeed;
      var p = v.play();
      if (p && typeof p.then === 'function') {
        p.then(() => log(label + '已开始播放'))
         .catch(() => log(label + '自动播放被拦截，请手动点一下播放键'));
      } else {
        log(label + '已发送播放指令');
      }
    } catch (e) { log(label + '播放失败：', e.message); }
  }

  // 某个视频播完：先看本节还有没有没看完的，有就播下一个，否则进下一节
  function onVideoEnded(v) {
    const s = srcOf(v);
    if (s) finishedSrc.add(s);
    log('一个视频播完');
    if (!autoNext) { log('自动下一节已关闭，请手动进入'); return; }
    if (advancing) return;
    setTimeout(() => {
      const frames = allFrames();
      const vids = allVideos(frames).map(x => x.v);
      const pending = vids.filter(vv => !isFinished(vv));
      if (pending.length > 0) {
        log('本节还有 ' + pending.length + ' 个视频未看完，接着播下一个');
        advancing = false;
        tryAutoPlay(pending[0], '下一个视频 ');
      } else {
        log('本节全部视频看完，进入下一节');
        advancing = true;
        const btn = findNextButton(frames);
        if (btn) goNext(btn);
        else log('没找到「下一节」按钮，请手动点击');
        setTimeout(() => { advancing = false; }, 3000);
      }
    }, nextDelay);
  }

  function bindVideo(v, path) {
    if (v.__speedHelperBound) return;
    v.__speedHelperBound = true;
    v.__lastSrc = srcOf(v);
    log('检测到视频 @', path);
    try { v.playbackRate = currentSpeed; } catch (e) {}

    try {
      v.addEventListener('ratechange', () => {
        if (Math.abs(v.playbackRate - currentSpeed) > 0.01) v.playbackRate = currentSpeed;
      });
    } catch (e) {}

    v.addEventListener('ended', () => onVideoEnded(v));

    if (v.readyState >= 2) tryAutoPlay(v, '视频 ');
    else {
      try { v.addEventListener('loadeddata', () => tryAutoPlay(v, '视频 '), { once: true }); } catch (e) {}
      setTimeout(() => tryAutoPlay(v, '视频 '), 1200);
    }
  }

  function tick() {
    const frames = allFrames();
    const vids = allVideos(frames);

    vids.forEach(({ v, path }) => {
      bindVideo(v, path);
      // 适配"同一个 video 元素换源"的多任务点：src 变了当作新视频播
      const s = srcOf(v);
      if (s && s !== v.__lastSrc) {
        v.__lastSrc = s;
        log('检测到视频切换（新任务点）');
        setTimeout(() => tryAutoPlay(v, '新任务点 '), 500);
      }
    });

    if (vids.length === 0 && tick._warned !== true) {
      log('警告：扫到 ' + frames.length + ' 个可访问框架、' + blockedCount +
          ' 个跨域框架，但 0 个 video。若确实在播视频，可能是播放器完全跨域 → 需要油猴版。');
      tick._warned = true;
    }
    return { frames: frames.length, blocked: blockedCount, videos: vids.length };
  }

  window.changeSpeed = function (s) {
    currentSpeed = Number(s);
    allVideos(allFrames()).forEach(({ v }) => { try { v.playbackRate = currentSpeed; } catch (e) {} });
    log('倍速切换为', currentSpeed + 'x');
  };
  window.toggleAutoNext = function () {
    autoNext = !autoNext;
    log('自动下一节：', autoNext ? '已开启' : '已关闭');
  };
  window.stopHelper = function () {
    if (timer) clearInterval(timer);
    log('已停止监听');
  };
  window.diagFrames = function () {
    const r = tick();
    log('诊断：可访问框架 ' + r.frames + ' 个，跨域 ' + r.blocked + ' 个，video ' + r.videos + ' 个');
    const vids = allVideos(allFrames());
    vids.forEach(({ v, path }, i) => {
      let d = '', t = '';
      try { d = (v.duration || 0).toFixed(0); } catch (e) {}
      try { t = v.currentTime.toFixed(0); } catch (e) {}
      log('  video[' + i + '] ' + path + ' 进度 ' + t + '/' + d + 's 暂停=' + v.paused + ' 已看完=' + isFinished(v));
    });
  };

  log('已启动（多任务点版）。当前 ' + currentSpeed + 'x，自动下一节：' + (autoNext ? '开' : '关'));
  const r = tick();
  log('扫描结果：可访问框架 ' + r.frames + ' 个，跨域 ' + r.blocked + ' 个，video ' + r.videos + ' 个');
  log('命令：changeSpeed(1.5) / toggleAutoNext() / stopHelper() / diagFrames()');
  timer = setInterval(tick, 800);
})();
