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
	easyimg = require('easyimage');

/**
 * localimage FieldType Constructor
 * @extends Field
 * @api public
 */

function localimage(list,path,options){
	this._underscoreMethods = ['format','uploadFile'];

	// event queues
	this._pre = {
		move:[] // Before file is moved into final destination
	};

	this._post = {
		move:[] // After file is moved into final destination
	};

	// resample params
	this._resample = [
		'thumbnailx160x160'
	];

	// TODO: implement filtering, usage disabled for now
	options.nofilter = true;

	// TODO: implement initial form, usage disabled for now
	if(options.initial){
		throw new Error('Invalid Configuration\n\n' +
			'localimage fields (' + list.key + '.' + path + ') do not currently support being used as initial fields.\n');
	}

	localimage.super_.call(this,list,path,options);

	// set default destination dir
	if(!options.dest){
		options.dest = 'public/assets';
	}

	// resample images
	if(options.resample){
		this._resample = this._resample.concat(options.resample);
	}

	// Allow hook into before and after
	if(options.pre && options.pre.move){
		this._pre.move = this._pre.move.concat(options.pre.move);
	}

	if(options.post && options.post.move){
		this._post.move = this._post.move.concat(options.post.move);
	}
}

/*!
 * Inherit from Field
 */

util.inherits(localimage,super_);


/**
 * Allows you to add pre middleware after the field has been initialised
 *
 * @api public
 */

localimage.prototype.pre = function(event,fn){
	if(!this._pre[event]){
		throw new Error('localimage (' + this.list.key + '.' + this.path + ') error: localimage.pre()\n\n' +
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

localimage.prototype.post = function(event,fn){
	if(!this._post[event]){
		throw new Error('localimage (' + this.list.key + '.' + this.path + ') error: localimage.post()\n\n' +
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

localimage.prototype.addToSchema = function(){

	var field = this,
		schema = this.list.schema;

	var paths = this.paths = {
		// fields
		filename:this._path.append('.filename'),
		path:this._path.append('.path'),
		size:this._path.append('.size'),
		filetype:this._path.append('.filetype'),
		// virtuals
		exists:this._path.append('.exists'),
		upload:this._path.append('_upload'),
		action:this._path.append('_action')
	};

	var schemaPaths = this._path.addTo({},{
		filename:String,
		path:String,
		size:Number,
		filetype:String
	});

	var src = function(item,type){
		return path.join(
			path.join(item.path.replace('public/','/'),'_resampled'),
				path.basename(item.filename,path.extname(item.filename)) + '_' + type + path.extname(item.filename)
		);
	};

	schema.method('thumb',function(type){
		return src(this,type);
	});

	schema.add(schemaPaths);

	var exists = function(item){
		var filepath = item.get(paths.path),
			filename = item.get(paths.filename);

		if(!filepath || !filename){
			return false;
		}

		return fs.existsSync(path.join(filepath,filename));
	};

	// The .exists virtual indicates whether a file is stored
	schema.virtual(paths.exists).get(function(){
		return schemaMethods.exists.apply(this);
	});

	var reset = function(item){
		item.set(field.path,{
			filename:'',
			path:'',
			size:0,
			filetype:''
		});
	};

	var schemaMethods = {
		exists:function(){
			return exists(this);
		},
		/**
		 * Resets the value of the field
		 *
		 * @api public
		 */
		reset:function(){
			reset(this);
		},
		/**
		 * Deletes the file from localimage and resets the field
		 *
		 * @api public
		 */
		delete:function(){
			if(exists(this)){
				fs.unlinkSync(path.join(this.get(paths.path),this.get(paths.filename)));
			}
			reset(this);
		}
	};

	_.each(schemaMethods,function(fn,key){
		field.underscoreMethod(key,fn);
	});

	// expose a method on the field to call schema methods
	this.apply = function(item,method){
		return schemaMethods[method].apply(item,Array.prototype.slice.call(arguments,2));
	};

	this.bindUnderscoreMethods();
};


/**
 * Formats the field value
 *
 * Delegates to the options.format function if it exists.
 * @api public
 */

localimage.prototype.format = function(item){
	if(this.hasFormatter())
		return this.options.format(item,item[this.path]);
	return this.href(item)
};


/**
 * Detects the field have formatter function
 *
 * @api public
 */

localimage.prototype.hasFormatter = function(){
	return this.options.format !== undefined;
}


/**
 * Return objects href
 *
 * @api public
 */

localimage.prototype.href = function(item){
	var file_path = item.get(this.paths.path),
		file_name  = item.get(this.paths.filename);
	return path.join(
		path.join(file_path.replace('public/','/'),'_resampled'),
		path.basename(file_name,path.extname(file_name))
		+ '_thumbnailx160x160' + path.extname(file_name)
	);
};


/**
 * Detects whether the field has been modified
 *
 * @api public
 */

localimage.prototype.isModified = function(item){
	return item.isModified(this.paths.path);
};


/**
 * Validates that a value for this field has been provided in a data object
 *
 * @api public
 */

localimage.prototype.validateInput = function(data){
	// TODO - how should file field input be validated?
	return true;
};


/**
 * Updates the value for this field in the item from a data object
 *
 * @api public
 */

localimage.prototype.updateItem = function(item,data){
	// TODO - direct updating of data (not via upload)
};


/**
 * Uploads the file for this field
 *
 * @api public
 */

localimage.prototype.uploadFile = function(item,file,update,callback){

	var field = this,
		prefix = field.options.datePrefix ? moment().format(field.options.datePrefix) + '-' : '',
		name = prefix + file.name;

	if(field.options.allowedTypes && !_.contains(field.options.allowedTypes,file.type)){
		return callback(new Error('Unsupported File Type: ' + file.type));
	}

	if('function' == typeof update){
		callback = update;
		update = false;
	}

	var doMove = function(callback){
		if(field.options.filename && 'function' == typeof field.options.filename){
			name = field.options.filename(item,name);
		}

		fs.move(file.path,path.join(field.options.dest,name),function(err){
			if(err) return callback(err);

			var fileData = {
				filename:name,
				path:field.options.dest,
				size:file.size,
				filetype:file.type
			};

			if(update){
				item.set(field.path,fileData);
			}

			// resampling image
			var resampledDir = path.join(field.options.dest,'_resampled');
			field._resample.map(function(ritem){
				var params = ritem.split('x');

				easyimg[params[0]]({
					src:path.join(field.options.dest,name),
					dst:path.join(
						resampledDir,
						path.basename(name,path.extname(name))
							+ '_' + ritem
							+ path.extname(name)
					),
					width:params[1],
					height:params[2]
				}).then(
					function(img){
					},
					function(err){
						return callback(err);
					}
				);
			});
			//

			callback(null,fileData);
		});
	};

	var checkExists = function(callback){
		if(field.options.filename && 'function' == typeof field.options.filename){
			name = field.options.filename(item,name);
		}
		if(fs.existsSync(path.join(field.options.dest,name))){
			// update file name by adding destination dir files counter
			var ls = fs.readdirSync(field.options.dest);
			name = path.basename(name,path.extname(name))
				+ ls.length
				+ path.extname(name);
			callback();
		}else{
			callback();
		}
	};

	async.eachSeries(this._pre.move,function(fn,next){
		fn(item,file,next);
	},function(err){
		if(err) return callback(err);

		checkExists(function(){
			doMove(function(err,fileData){
				if(err) return callback(err);

				async.eachSeries(field._post.move,function(fn,next){
					fn(item,file,fileData,next);
				},function(err){
					if(err) return callback(err);
					callback(null,fileData);
				});
			});
		});
	});
};


/**
 * Returns a callback that handles a standard form submission for the field
 *
 * Expected form parts are
 * - `field.paths.action` in `req.body` (`clear` or `delete`)
 * - `field.paths.upload` in `req.files` (uploads the file to localimage)
 *
 * @api public
 */

localimage.prototype.getRequestHandler = function(item,req,paths,callback){

	var field = this;

	if(utils.isFunction(paths)){
		callback = paths;
		paths = field.paths;
	}else if(!paths){
		paths = field.paths;
	}

	callback = callback || function(){
	};

	return function(){

		if(req.body){
			var action = req.body[paths.action];

			if(/^(delete|reset)$/.test(action))
				field.apply(item,action);
		}

		if(req.files && req.files[paths.upload] && req.files[paths.upload].size){
			return field.uploadFile(item,req.files[paths.upload],true,callback);
		}

		return callback();

	};

};


/**
 * Immediately handles a standard form submission for the field (see `getRequestHandler()`)
 *
 * @api public
 */

localimage.prototype.handleRequest = function(item,req,paths,callback){
	this.getRequestHandler(item,req,paths,callback)();
};


/*!
 * Export class
 */

exports = module.exports = localimage;
