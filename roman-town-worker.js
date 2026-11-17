// Roman Town — draws pieces of the town off the page's thread: given the
// town once, then any number of pieces of it, each sent back as a bitmap.
importScripts('roman-town-view.js');

let scene = null;
onmessage = async e => {
  const m = e.data;
  if (m.type === 'scene') {
    scene = RomanTownView.scene(m.town, m.opts);
    postMessage({ type: 'ready' });
  } else if (m.type === 'tile') {
    const px = RomanTownView.tile(scene, m.cam, m.sky);
    const bmp = await createImageBitmap(new ImageData(px, m.cam.w, m.cam.h));
    postMessage({ type: 'tile', key: m.key, gen: m.gen, bmp }, [bmp]);
  }
};
