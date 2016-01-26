#!/usr/bin/env node

var H = require ( 'highland' );
var R = require ( 'ramda' );
var path = require ( 'path' );
var fs = require ( 'fs' );
var rr = require ( 'recursive-readdir' );
var W = require ( 'highland-wrapcallback' );
var handlebars = require ( 'handlebars' );
var glob = require ( 'glob' );

var errorIf = function ( pred, error ) {
    return H.wrapCallback ( function ( input, callBack ) {
        if ( pred ( input ) ) {
            return callBack ( error );
        }

        return callBack ( null, input );
    } );
};

H ( [ path.resolve ( './deployConf.js' ) ] )
    .flatMap ( function ( configFile ) {
        return H.wrapCallback ( function ( configFile, callBack ) {
            fs.exists ( configFile, function ( exists ) {
                if ( exists ) {
                    return callBack ( null, exists );
                }
                
                return callBack ( exists );
            } );
        } )( configFile )
            .flatMap ( errorIf ( R.isNil, "Config file does not exist" ) )
            .map ( R.always ( configFile ) )
    } )
    .map ( require )
    .map ( R.ifElse ( R.always ( R.isNil ( process.argv[2] ) ), R.identity, R.prop ( process.argv[2] ) ) )
    .flatMap ( function ( config ) {
        return H ( [ path.resolve ( './' ) ] )
            .flatMap ( H.wrapCallback ( function ( path, callBack ) {
                rr ( path, config.Omit || [], callBack );
            } ) )
            .sequence ()
            /*.flatFilter ( function ( filename ) {
                return H ( config.Omit )
                    .flatMap ( H.wrapCallback ( glob ) )
                    .collect ()
                    .map ( R.flatten )
                    .map ( R.map ( path.resolve ) )
                    .map ( R.contains ( filename ) )
                    .map ( R.not );
            } )*/
            .flatMap ( function ( filename ) {
                return H ( [ filename ] )
                    .invoke ( 'replace', [ path.resolve ( './' ) + path.sep, '' ] )
                    .map ( R.replace ( /\\/g, '/' ) )
                    .map ( R.add ( config.Folder ? ( config.Folder + path.sep ) : '' ) )
                    .flatMap ( function ( Key ) {
                        return H.wrapCallback ( fs.readFile )( filename )
                            .map ( function ( Body ) {
                                var body;

                                if ( config.data && Body.toString ( 'utf8' ).match ( '{{' ) && Body.toString ( 'utf8' ).match ( '}}' ) ) {
                                    try {
                                        body = handlebars.compile ( Body.toString ( 'utf8' ) )( config.data );
                                    } catch ( error ) {
                                        body = Body;
                                    }
                                } else {
                                    body = Body;
                                }

                                return {
                                    Key: Key,
                                    Body: body
                                };
                            } );
                    } )
                    .flatMap ( function ( fileParms ) {
                        var dirname = path.dirname ( fileParms.Key );

                        var mkdirRecursive = function ( dirname, cb ) {
                            fs.exists ( path.dirname ( dirname ), function ( exists ) {
                                if ( exists ) {
                                    fs.mkdir ( dirname, function () {
                                        return cb ( null, fileParms );
                                    } );
                                } else {
                                    mkdirRecursive ( path.dirname ( dirname ), function ( error, fileParms ) {
                                        if ( error ) {
                                            return cb ( error );
                                        }

                                        fs.mkdir ( dirname, function () {
                                            return cb ( null, fileParms );
                                        } );
                                    } );
                                }
                            } );
                        };

                        return H ( [ dirname ] ).flatMap ( H.wrapCallback ( mkdirRecursive ) );
                    } )
                    .flatMap ( H.wrapCallback ( function ( fileParms, cb ) {
                        fs.writeFile ( fileParms.Key, fileParms.Body, cb );
                    } ) )
                    .map ( function () {
                        return 'Succesfully processed file ' + filename;
                    } );
            } );

    } )
    .errors ( R.compose ( R.unary ( console.error ), R.add ( 'ERROR: ' ) ) )
    .each ( console.log );
