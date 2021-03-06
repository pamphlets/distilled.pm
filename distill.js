var Build = require('lazy-build')
var Pamphlet = require('pamphlet')
var autoprefixer = require('autoprefixer')
var browserify = require('browserify')
var cssnano = require('cssnano')
var fg = require('fast-glob')
var many = require('pull-many')
var path = require('path')
var postcss = require('gulp-postcss')
var pull = require('lazy-build/pull')
var resolve = require('pull-resolve')
var sortBy = require('sort-by')
var toPull = require('stream-to-pull-stream')
var variables = require('postcss-css-variables')
var vinyl = require('pull-vinyl')

var build = Build.dest('public')

var press = Pamphlet.init({
  name: 'Distilled Pamphlets',
  baseUrl: 'https://distilled.pm',
  feedUrl: '/feed.atom',
  defaultLayout: 'elements/article',
  stylesheets: ['/style.css'],
  scripts: ['/bundle.js']
})

var pmOpts = {
  concat: 'pamphlets.json',
  sort: sortBy('-date')
}

build.add('index.html', function () {
  return pull(
    vinyl.src(`assets/pamphlets/*.md`),
    toPull.duplex(press.fromFile(pmOpts)),
    toPull.duplex(press.toHtml('index.html')),
    build.target(src => 'index.html'),
    build.write()
  )
})

build.add('feed.atom', function (params) {
  return pull(
    vinyl.src(`assets/pamphlets/*.md`),
    toPull.duplex(press.fromFile(pmOpts)),
    toPull.duplex(press.toAtom('feed.atom')),
    build.target(src => 'feed.atom'),
    build.write()
  )
})

build.add('distilled-magazine-issue-*/index.html', async function (params) {
  var collectOpts = {
    concat: 'issue.json',
    sort: editorials(),
    reverse: true
  }
  var issues = await fg('assets/magazine/issue-' + params[0], {onlyDirectories: true})
  var streams = issues.map(issue => {
    var number = issue.split('-').pop()
    return pull(
      vinyl.src(path.join(issue, '*.md')),
      toPull.duplex(press.fromFile(collectOpts)),
      toPull.duplex(press.toHtml('index.html')),
      build.target(() => path.join(`distilled-magazine-issue-${number}/index.html`)),
      build.write()
    )
  })

  return resolve(many(streams))
})

build.add('**/index.html', function (params) {
  return pull(
    many([
      vinyl.src(`assets/magazine/**/${params[0]}.md`),
      vinyl.src(`assets/pamphlets/${params[0]}.md`)
    ]),
    toPull.duplex(press.fromFile()),
    toPull.duplex(press.toHtml()),
    build.target(src => path.join(src.dir, 'index.html')),
    build.write()
  )
})

build.add('*.css', function (params) {
  var plugins = [
    autoprefixer(),
    variables(),
    cssnano()
  ]

  return pull(
    vinyl.src(`assets/styles/${params[0]}.css`),
    toPull.duplex(postcss(plugins)),
    build.target(src => src.base),
    build.write()
  )
})

build.add('bundle.js', function () {
  var bs = browserify('./client.js')

  return build.write({
    path: 'bundle.js',
    contents: bs.bundle()
  })
})

build.cli()

/**
 * Helpers:
 */
function editorials () {
  var files = [
    'letter-from-the-editor-in-chief',
    'ed-individualism-vs-collectivism',
    'the-origin-of-principles',
    'the-art-of-the-possible'
  ]

  return function (a, b) {
    if (files.indexOf(path.basename(a.permalink)) > -1) {
      return 1
    } else if (files.indexOf(path.basename(b.permalink)) === -1) {
      return -1
    }
    return 0
  }
}
