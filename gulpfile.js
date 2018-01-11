var Vinyl = require('vinyl')
var atom = require('./atom')
var autoprefixer = require('autoprefixer')
var browserify = require('browserify')
var cssnano = require('cssnano')
var del =  require('del')
var fs = require('fs')
var gulp = require('gulp')
var gutil = require('gulp-util')
var live = require('live-server')
var marked = require('marked')
var path = require('path')
var pbox = require('pbox')
var postcss = require('gulp-postcss')
var sort = require('gulp-sort')
var sortBy = require('sort-by')
var source = require('vinyl-source-stream')
var through = require('through2')
var variables = require('postcss-css-variables')
var yml = require('js-yaml')

var all, pamphlets
var baseUrl = 'https://distilled.pm/'
var target = path.join(__dirname, 'public')


/**
 * Content sources
 */
var globs = {
    articles: ['content/magazine/**/*.md', 'content/pamphlets/*.md'],
    assets: ['assets/**', '!assets/**/*.css'],
    elements: 'elements/*.js',
    magazines: 'content/magazine/**/*.md',
    pamphlets: 'content/pamphlets/*.md',
    style: 'assets/style.css'
}

var prepare = function (done) {
    all = gulp.src(globs['articles'])
        .pipe(jekyllPostToJson())

    pamphlets = gulp.src(globs['pamphlets'])
        .pipe(sort({asc: false}))
        .pipe(jekyllPostToJson())
        .pipe(collectJsonPosts())

    done()
}

var clean = function () {
    return del(target)
}


/**
 * Build tasks
 */
var articles = function () {
    return all.pipe(jsonPostsToPage())
        .pipe(gulp.dest(target))
}

var assets = function () {
    return gulp.src(globs['assets'])
        .pipe(gulp.dest(target))
}

var feed = function () {
    return pamphlets.pipe(jsonPostsToFeed('feed.atom'))
        .pipe(gulp.dest(target))
}

var homepage = function () {
    return pamphlets.pipe(jsonPostsToPage('index.html'))
        .pipe(gulp.dest(target))
}

var magazine = function (issue) {
    function run () {
        return gulp.src(path.join('content', 'magazine', issue, '**/*.md'))
            .pipe(sort(editorials(issue)))
            .pipe(jekyllPostToJson())
            .pipe(collectJsonPosts('distilled-magazine-' + issue + '.json'))
            .pipe(jsonPostsToPage(false, {url: baseUrl + issue}))
            .pipe(gulp.dest(target))
    }
    Object.defineProperty(run, 'name', {value: issue})

    return run
}

var style = function () {
    var plugins = [
        autoprefixer(),
        variables(),
        cssnano()
    ]

    return gulp.src(globs['style'])
        .pipe(postcss(plugins))
        .pipe(gulp.dest(target))
}

var js = function (done) {
    var bundle = fs.createWriteStream(path.join(target, 'bundle.js'))
    browserify('./client.js').bundle().pipe(bundle)
    bundle.on('error', done)
    bundle.on('finish', done)
}

var site = gulp.parallel(
    articles,
    assets,
    feed,
    homepage,
    magazine('issue-1'),
    magazine('issue-2'),
    magazine('issue-3'),
    magazine('issue-4'),
    style,
    js
)

var build = gulp.series(prepare, site)


/**
 * Development tasks
 */
var watch = function (done) {
    gulp.watch(globs['articles'], articles)
    gulp.watch(globs['pamphlets'], gulp.parallel(feed, homepage))
    gulp.watch(globs['style'], style)
    gulp.watch(globs['assets'], assets)

    gulp.watch(globs['elements'], gulp.parallel(articles, homepage)).on('change', function(change) {
        delete require.cache[change.path]
    })

    done()
}

var serve = function () {
    live.start({
        port: 1789,
        root: './public',
        open: false,
        logLevel: 2
    })
}


/**
 * Expose tasks
 */
gulp.task('default', build)
gulp.task('build', gulp.series(clean, build))
gulp.task('serve', gulp.series(build, watch, serve))

gulp.task('test', function () {
    var slug = doc => '/' + path.basename(doc.path, '.md').split('-').slice(3).join('-')
    var jsonOpts = {
        concat: 'posts.json',
        props: {
            content: () => content => marked(content.join('\n---\n')),
            date: () => date => new Date(date),
            header: doc => () => path.dirname(doc.path).includes('magazine') ? 'Distilled Magazine' : 'Distilled Pamphlets',
            slug: doc => () => slug(doc),
            url: doc => () => baseUrl + slug(doc)
        },
        sort: sortBy('-date')
    }

    return gulp.src(globs['pamphlets'])
        .pipe(jekyllPostsToJson(jsonOpts))
        .pipe(jsonPostsToPage('posts.html'))
        .pipe(gulp.dest(__dirname))
})


/**
 * Plugins:
 */
function jekyllPostsToJson (opts) {
    if (!opts) {
        opts = {}
    }
    var collected = []
    var stringify = (data) => JSON.stringify(data, opts.replacer, opts.space)

    return through.obj(function (doc, encoding, cb) {
        var props = {}

        if (opts.props) for (var prop in opts.props) {
            props[prop] = opts.props[prop](doc)
        }
        var filename = path.basename(doc.path.replace(/\.md$/, '.json'))
        var parsed = pbox.parse(doc.contents.toString(), {props})

        if (!opts.concat && !opts.sort) {
            return cb(null, vinyl(doc.path, stringify(parsed)))
        }
        collected = collected.concat(parsed)
        cb()
    }, function (cb) {
        if (!collected.length) {
            return cb()
        }
        if (opts.sort) {
            collected.sort(opts.sort)
        }
        cb(null, vinyl(opts.concat, stringify(collected)))
    })
}

function jekyllPostToJson (opts) {
    if (!opts) {
        opts = {}
    }

    return through.obj(function (doc, encoding, cb) {
        var post, content
        var slug = path.basename(doc.path, '.md').split('-').slice(3).join('-')
        var txt = doc.contents.toString()

        if (/^---\n/.test(txt)) {
            var parts = txt.split('\n---\n')
            post = yml.safeLoad(parts[0].replace(/^---\n/, ''))
            content = parts.slice(1).join('\n---\n').replace(/^\n/, '')
        } else {
            post = {}
            content = txt
        }
        post.content = marked(content)
        post.header = path.dirname(doc.path).includes('magazine') ? 'Distilled Magazine' : 'Distilled Pamphlets'
        post.slug = '/' + slug
        post.url = baseUrl + slug

        cb(null, vinyl(slug + '.json', JSON.stringify(post, opts.replacer, opts.space)))
    })
}

function collectJsonPosts (filename) {
    var array = '['

    return through.obj(function (doc, encoding, cb) {
        array += doc.contents.toString()
        array += ','
        cb()
    }, function (cb) {
        filename = filename || 'posts.json'
        array = array.replace(/\,$/, '') + ']'
        cb(null, vinyl(filename, array))
    })
}

function jsonPostsToPage (filename, data) {
    return through.obj(function (doc, encoding, cb) {
        var content, file
        var posts = JSON.parse(doc.contents.toString())
        var layout = require('./elements/article')

        if (Array.isArray(posts)) {
            data = data || {url: baseUrl}
            content = posts.map(layout).join('\n')
        } else {
            data = posts
            content = layout(data)
        }
        file = filename || doc.path.replace(/\.json$/, '/index.html')
        cb(null, vinyl(file, wrap(data, content)))
    })

    function wrap (data, content) {
        return '<!doctype html><html>' + require('./elements/head')(data) + '<body>' + content + '</body></html>'
    }
}

function jsonPostsToFeed (filename) {
    return through.obj(function (doc, encoding, cb) {
        var content, updated
        var posts = JSON.parse(doc.contents.toString())

        if (Array.isArray(posts)) {
            updated = posts[0].date
            content = posts.map(atom.entry).join('\n')
        } else {
            throw 'Atom feed can only be generated from a collection'
        }
        filename = filename || doc.path.replace(/\.json$/, '.atom')
        cb(null, vinyl(filename, atom.feed(content, updated)))
    })
}


/**
 * Helpers:
 */
function editorials (folder) {
    var files = [
        '2012-07-22-letter-from-the-editor-in-chief.md',
        '2012-10-31-ed-individualism-vs-collectivism.md',
        '2013-03-25-the-origin-of-principles.md',
        '2013-09-03-the-art-of-the-possible.md'
    ]

    if (folder === 'extra') {
        return {asc : false}
    }

    return  {
        asc: false,
        comparator: function (a, b) {
            if (files.indexOf(path.basename(a.path)) > -1) {
                return 1
            }
            else if (files.indexOf(path.basename(b.path)) === -1) {
                return -1
            }
            return 0
        }
    }
}

function vinyl (path, contents) {
    if (verbose()) {
        gutil.log('Creaming', path)
    }
    return new Vinyl({
        path: path,
        contents: new Buffer(contents)
    })
}

function verbose () {
    return process.argv.indexOf('--verbose') !== -1
}
