/**
 * makeFunction -- construct a function, with or without scope
 *
 * The easiest way to apply the bson scope to the function is
 * with the js `with` keyword.  However, `with` is not allowed
 * in 'use strict' mode, so move it here and run it non-strict.
 *
 * 2016-05-21 - AR.
 */

module.exports = makeFunction;


/*
 * parse the given function source "function(...) { ... }", into an function
 * that will see the properties of the scope object in its global scope.
 * Note that `new Function()' expects just the function code, while bson
 * storese a full the `toString()` function source.  We use eval() to
 * parse the function to not have to split the `function` keyword out
 * of the source code ourselves.  The BSON spect itself implies that
 * the function is to be eval-d (http://bsonspec.org/spec.html)
 */
function makeFunction( code, scope ) {
    try {
        // eval(code) returns nothing for a function definition, so set f
        // (or could coerce to an expression with eval("false||"+code)
        code = "var f = " + code;
        if (scope) with (scope) eval(code); else eval(code)
        return f;
    }
    catch (err) {
        // eval throws, self-protect against parse errors.
        // TODO: kill the app?  replace with null?  with a noop?
        // or return the error, which will kill the caller when run?
        return err;
    }
}
