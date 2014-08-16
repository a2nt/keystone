/*!
 * Module dependencies.
 */

var fs = require('fs.extra'),
	path = require('path'),
	_ = require('underscore'),
	moment = require('moment'),
	keystone = require('../../'),
	async = require('async'),
	util = require('util'),
	utils = require('keystone-utils'),
	super_ = require('../field'),
	async = require('async'),
	easyimg = require('easyimage');

/**
 * localimages FieldType Constructor
 * @extends Field
 * @api public
 */

function localimages(list, path, options) {
	this._underscoreMethods = ['format', 'uploadFiles'];

	// resample params
	this._resample = [
		'thumbnailx160x160'
	];

	// event queues
	this._pre = {
		move: [] // Before file is moved into final destination
	};

	this._post = {
		move: [] // After file is moved into final destination
	};

	// TODO: implement filtering, usage disabled for now
	options.nofilter = true;

	// TODO: implement initial form, usage disabled for now
	if (options.initial) {
		throw new Error('Invalid Configuration\n\n' +
			'localimages fields (' + list.key + '.' + path + ') do not currently support being used as initial fields.\n');
	}

	localimages.super_.call(this, list, path, options);

	// set default destination dir
	if (!options.dest) {
		options.dest = 'public/assets';
	}

	// resample images
	if (options.resample) {
		this._resample = this._resample.concat(options.resample);
	}

	// Allow hook into before and after
	if (options.pre && options.pre.move) {
		this._pre.move = this._pre.move.concat(options.pre.move);
	}

	if (options.post && options.post.move) {
		this._post.move = this._post.move.concat(options.post.move);
	}
}

/*!
 * Inherit from Field
 */

util.inherits(localimages, super_);


/**
 * Allows you to add pre middleware after the field has been initialised
 *
 * @api public
 */

localimages.prototype.pre = function(event, fn) {
	if (!this._pre[event]) {
		throw new Error('localimages (' + this.list.key + '.' + this.path + ') error: localimages.pre()\n\n' +
			'Event ' + event + ' is not supported.\n');
	}
	this._pre[event].push(fn);
	return this;
};


/**
 * Allows you to add post middleware after the field has been initialised
 *
 * @api public
 */

localimages.prototype.post = function(event, fn) {
	if (!this._post[event]) {
		throw new Error('localimages (' + this.list.key + '.' + this.path + ') error: localimages.post()\n\n' +
			'Event ' + event + ' is not supported.\n');
	}
	this._post[event].push(fn);
	return this;
};


/**
 * Registers the field on the List's Mongoose Schema.
 *
 * @api public
 */

localimages.prototype.addToSchema = function() {

	var mongoose = keystone.mongoose;

	var field = this,
		schema = this.list.schema;

	var paths = this.paths = {
		// fields
		filename:		this._path.append('.filename'),
		path:			  this._path.append('.path'),
		size:			  this._path.append('.size'),
		filetype:		this._path.append('.filetype'),
		resampled:		this._path.append('.resampled'),
		// virtuals
		exists:			this._path.append('.exists'),
		upload:			this._path.append('_upload'),
		action:			this._path.append('_action'),
		order: 			this._path.append('_order')
	};

	var schemaPaths = new mongoose.Schema({
		filename:		String,
		path:			String,
		size:			Number,
		filetype:		String
	});

	var src  = function(item,type) {
		return path.join(
			path.join(item.path.replace('public/','/'),'_resampled'),
			path.basename(item.filename,path.extname(item.filename))+'_'+type+path.extname(item.filename)
		);
	};

	schemaPaths.method('thumb',function(type){
		return src(this,type);
	});

	schema.add(this._path.addTo({}, [schemaPaths]));

	var exists = function(item) {
		var filepaths = item.get(paths.path),
			filename = item.get(paths.filename);

		if (!filepaths || !filename) {
			return false;
		}

		return fs.existsSync(path.join(filepaths, filename));
	};

	// The .exists virtual indicates whether a file is stored
	schema.virtual(paths.exists).get(function() {
		return schemaMethods.exists.apply(this);
	});


	var reset = function(item) {
		item.set(field.path, {
			filename: '',
			path: '',
			size: 0,
			filetype: ''
		});
	};

	var schemaMethods = {
		exists: function() {
			return exists(this);
		},
		/**
		 * Resets the value of the field
		 *
		 * @api public
		 */
		reset: function() {
			reset(this);
		},
		/**
		 * Deletes the file from localimages and resets the field
		 *
		 * @api public
		 */
		delete: function() {
			if (exists(this)) {
				fs.unlinkSync(path.join(this.get(paths.path), this.get(paths.filename)));
			}
			reset(this);
		}
	};

	_.each(schemaMethods, function(fn, key) {
		field.underscoreMethod(key, fn);
	});

	// expose a method on the field to call schema methods
	this.apply = function(item, method) {
		return schemaMethods[method].apply(item, Array.prototype.slice.call(arguments, 2));
	};

	this.removeImage = function(item, id, method, callback) {
		var images = item.get(field.path);
		if ('number' != typeof id) {
			for (var i = 0; i < images.length; i++) {
				if (images[i]._id == id) {
					id = i;
					break;
				}
			}
		}
		var img = images[id];
		if (!img) return;

		if (method == 'delete') {
			var origPath = path.join(img.path,img.filename);
			if(fs.existsSync(origPath)){
				fs.unlinkSync(origPath);
			}
			// remove resampled
			var resampledDir = path.join(this.options.dest,'_resampled');
			field._resample.map(function(ritem){
				var params = ritem.split('x');
				var thumbPath = path.join(
					resampledDir,
						path.basename(img.filename,path.extname(img.filename))
						+'_'+ritem
						+path.extname(img.filename)
				);
				if(fs.existsSync(thumbPath)){
					fs.unlinkSync(thumbPath);
				}
			});
			//
		}

		images.splice(id, 1);
		if (callback) {
			item.save(('function' != typeof callback) ? callback : undefined);
		}
	};

	this.bindUnderscoreMethods();
};


/**
 * Formats the field value
 *
 * Delegates to the options.format function if it exists.
 * @api public
 */

localimages.prototype.format = function(item){
	if(this.hasFormatter())
		return this.options.format(item, item[this.path]);

	return path.join(
		path.join(item.path.replace('public/','/'),'_resampled'),
		path.basename(item.filename,path.extname(item.filename))+'_thumbnailx160x160'+path.extname(item.filename)
	);
};


/**
 * Detects the field have formatter function
 *
 * @api public
 */

localimages.prototype.hasFormatter = function(){
	return this.options.format !== undefined;
}

/**
 * Detects whether the field has been modified
 *
 * @api public
 */

localimages.prototype.isModified = function(item) {
	return item.isModified(this.paths.path);
};


/**
 * Validates that a value for this field has been provided in a data object
 *
 * @api public
 */

localimages.prototype.validateInput = function(data) {
	// TODO - how should file field input be validated?
	return true;
};


/**
 * Updates the value for this field in the item from a data object
 *
 * @api public
 */

localimages.prototype.updateItem = function(item, data) {
	// TODO - direct updating of data (not via upload)
};


/**
 * Uploads the file for this field
 *
 * @api public
 */

localimages.prototype.uploadFiles = function(item, files, update, callback) {

	var field = this;
	var fileDatas = [];

	_.each(files, function(file){

		var prefix = field.options.datePrefix ? moment().format(field.options.datePrefix) + '-' : '',
			name = prefix + file.name;

		if (field.options.allowedTypes && !_.contains(field.options.allowedTypes, file.type)){
			return callback(new Error('Unsupported File Type: '+file.type));
		}

		if ('function' == typeof update) {
			callback = update;
			update = false;
		}

		var doMove = function(callback) {
			if(field.options.filename && 'function' == typeof field.options.filename) {
				name = field.options.filename(item, name);
			}

			fs.move(file.path, path.join(field.options.dest, name), function(err) {
				if (err) return callback(err);

				var fileData = {
					filename: name,
					path: field.options.dest,
					size: file.size,
					filetype: file.type
				};

				if (update) {
					item.set(field.path, fileData);
				}else{
					item.get(field.path).push(fileData);
				}

				// resampling images
				var resampledDir = path.join(field.options.dest,'_resampled');
				field._resample.map(function(ritem){
					var params = ritem.split('x');

					easyimg[params[0]]({
						src:path.join(field.options.dest,name),
						dst:path.join(
							resampledDir,
								path.basename(name,path.extname(name))
								+'_'+ritem
								+path.extname(name)
						),
						width:params[1],
						height:params[2]
					}).then(
						function(img){},
						function (err){return callback(err);}
					);
				});
				//

				fileDatas.push(fileData);
				callback(null, fileData);
			});
		};

		var checkExists = function(callback){
			if(field.options.filename && 'function' == typeof field.options.filename) {
				name = field.options.filename(item, name);
			}
			if(fs.existsSync(path.join(field.options.dest,name))){
				// update file name by adding destination dir files counter
				var ls = fs.readdirSync(field.options.dest);
				name = path.basename(name,path.extname(name))
					+ls.length
					+path.extname(name);
				callback();
			}else{
				callback();
			}
		};

		async.eachSeries(this._pre.move, function(fn, next) {
			fn(item, file, next);
		}, function(err) {
			if (err) return callback(err);
			checkExists(function(){
				doMove(function(err,fileData){
					if(err) return callback(err);
					async.eachSeries(field._post.move,function(fn,next){
						fn(item,file,fileData,next);
					},function(err){
						if(err) return callback(err);
						if(fileDatas.length == files.length){
							callback(null,fileDatas);
						}
					});
				})
			});
		});

	}, this);


};


/**
 * Returns a callback that handles a standard form submission for the field
 *
 * Expected form parts are
 * - `field.paths.action` in `req.body` (`clear` or `delete`)
 * - `field.paths.upload` in `req.files` (uploads the file to localimages)
 *
 * @api public
 */

localimages.prototype.getRequestHandler = function(item, req, paths, callback) {

	var field = this;

	if (utils.isFunction(paths)) {
		callback = paths;
		paths = field.paths;
	} else if (!paths) {
		paths = field.paths;
	}

	callback = callback || function() {};

	return function() {

		// Order
		if (req.body[paths.order]) {
			var files = item.get(field.path),
			newOrder = req.body[paths.order].split(',');

			files.sort(function(a, b) {
				return (newOrder.indexOf(a._id.toString()) > newOrder.indexOf(b._id.toString())) ? 1 : -1;
			});
		}

		// Removals
		if (req.body && req.body[paths.action]) {
			var actions = req.body[paths.action].split('|');

			actions.forEach(function(action) {
				action = action.split(':');
				var method = action[0],
					ids = action[1];

				if (!(/^(remove|delete)$/.test(method)) || !ids) return;

				ids.split(',').forEach(function(id){
					field.removeImage(item, id, method);
				});
			});
		}

		// Upload new files
		if (req.files && req.files[paths.upload] && (req.files[paths.upload].length > 0)) {
			return field.uploadFiles(item, req.files[paths.upload], false, callback);
		}

		return callback();

	};

};


/**
 * Immediately handles a standard form submission for the field (see `getRequestHandler()`)
 *
 * @api public
 */

localimages.prototype.handleRequest = function(item, req, paths, callback) {
	this.getRequestHandler(item, req, paths, callback)();
};


/*!
 * Export class
 */

exports = module.exports = localimages;
