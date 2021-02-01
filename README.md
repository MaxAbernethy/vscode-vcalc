# Vector Calculator

This extension allows you to do basic calculations in the text editor.  Numbers, vectors and matrices in your text are turned into links that you can control+click to do arithmetic, trigonometry, dot and cross products, matrix multiplication, and more.

## Inputs
The extension parses plaintext documents to find numbers and turns them into colored links.
* Scalars are colored blue
* Numbers grouped by () [] or {} are vectors and are colored yellow
* Vectors of the same length grouped by () [] or {} are column-major matrices and are colored purple

You can also input values using the vectorcalc.inputOperand command, which also provides access to named constants like pi and e.  You can access it through the command palette or assign a key binding to it.

## Operators
When you click a link, its value is selected and a list of operators is shown.  Some operators are **unary**, like vector length and reciprocal, and the result will be calculated right away.  Others are **binary**, like addition or dot product, so the result will be calculated when you click another link for the second operand.  Either way, the result is selected just the same as if it were a link you clicked in the document, so you can chain together more operators.

## Outputs
There are a few ways to output the results of your operations.
* The **copy** operator moves the result to the clipboard
* The **push** operator moves the result to a stack that you can access with **pop** in the vectorcalc.inputOperand command.
* The **append** operator writes the result to the end of the document
* The **replace** operator writes the result over the link you clicked to begin the current chain of operations
* All operands and results are logged in the vcalc channel of the output panel.

## Tips
You can add a keyboard shortcut for editor.action.openLink which will click the link that the caret is on, and operators can be chosen by typing the first couple characters of their names.  This can be a lot faster than using the mouse!

## Other details
* All angles are in radians
* Scalar operators are applied per component to vectors and matrices.  For example 10 + (1, 2, 3) = (11, 12, 13), acos((1, 0), (0, 1)) = ((pi, 0), (0, pi)
* There are some operators that treat a vector4 (a, b, c, d) as the plane ax + by + cz + d = 0:
    * The **plane** operator takes a vector3 direction and a vector3 position, and returns the plane through that point with normal in that direction.
    * The **planeDistance** operator takes a vector3 position and a vector4 plane, and returns the point's signed distance to the plane.
* Vector operators try to "just work" when the vectors are the wrong length.  For instance, if you use **cross**, **plane**, or **angle** with a vector4, it will just use the first three components rather than failing.
