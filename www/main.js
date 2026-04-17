import { marked } from "https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js";

const $ = x => document.querySelector(x);

const md = await (await fetch('content.md')).text();

const html = document.createElement('div');

html.innerHTML = marked.parse(md);

// Wrap h1 elements and their following content in slide divs
const elements = Array.from(html.children);
const slides = [];
let currentSlide = null;

elements.forEach(element => {
  if (element.tagName === 'H1') {
    // Start a new slide
    currentSlide = document.createElement('div');
    currentSlide.className = 'slide';
    currentSlide.appendChild(element);
    slides.push(currentSlide);
  } else if (currentSlide) {
    // Add to current slide
    currentSlide.appendChild(element);
  } else {
    // Elements before first h1 (if any)
    const preSlide = document.createElement('div');
    preSlide.className = 'slide';
    preSlide.appendChild(element);
    slides.push(preSlide);
  }
});

// Clear html and append all slides
html.innerHTML = '';
slides.forEach(slide => html.appendChild(slide));

let slideNo = 1;
let max = [...html.querySelectorAll('.slide')].length;

function showSlide(number) {
  number = +(number + '').replace('#', '');
  $('.content').setAttribute('page-no', number);
  $('.page-counter').innerHTML = number + '/' + max;
  number--;
  let slides = [...html.querySelectorAll('.slide')];
  $('.content').innerHTML = slides[number].innerHTML;
}

document.body.addEventListener('keyup', e => {
  if (e.key === 'ArrowLeft') {
    slideNo--;
    if (slideNo < 1) { slideNo = max; }
  }
  if (e.key === 'ArrowRight') {
    slideNo++;
    if (slideNo > max) { slideNo = 1; }
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    location.hash = slideNo;
  }
  if (e.key === 'f') {
    let html = document.querySelector('html');
    document.fullscreenElement ? document.exitFullscreen() : html.requestFullscreen();
  }
});

window.onhashchange = () => showSlide(location.hash);

slideNo = +(location.hash.slice(1) || '1');
showSlide(slideNo);

document.body.addEventListener('click', e => {
  let a = e.target.closest('a');
  if (!a) { return; }
  let href = a.getAttribute('href');
  if (!href.startsWith('http') && !href.endsWith('.pdf')) { return; }
  a.setAttribute('target', '_blank');
});