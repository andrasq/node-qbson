/**
 * makeFunction -- construct a function, with or without scope
 *
 * The easiest way to apply the bson scope to the function is
 * with the js `with` keyword.  However, `with` is not allowed
 * in 'use strict' mode, so move it here and have it non-strict.
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
    if (!scope) scope = {};

    // eval returns the value of the expression, but nothing for function definitions
    // Coerce the function definition to an expression with ||.
    // Note that `eval` will throw on error.

    with (scope) { return eval("false || " + code); }
}
