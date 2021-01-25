# Vector Calculator

This extension allows you to do basic calculations in the text editor.  Numbers, vectors and matrices in your text are turned into links that you can control+click to do arithmetic, trigonometry, dot and cross products, matrix multiplication, and more.

## Inputs
The extension parses plaintext documents to find numbers and turns them into colored links.
* Scalars are colored blue
* Numbers grouped by () [] or {} are vectors and are colored yellow
* Vectors of the same length grouped by () [] or {} are column-major matrices and are colored purple

## Operators
When you click a link, its value is selected and a list of operators is shown.  Some operators are **unary**, like vector length and reciprocal, and the result will be calculated right away.  Others are **binary**, like addition or dot product, so the result will be calculated when you click another link for the second operand.  Either way, the result is selected just the same as if it were a link you clicked in the document, so you can chain together more operators.

## Outputs
There are a few ways to output the results of your operations.
* The **copy** operator moves the result to the clipboard
* The **append** operator writes the result to the end of the document
* The **replace** operator writes the result over the first operand in the document
* All operands and results are logged in the vcalc channel of the output panel.

## Tips
You can add a keyboard shortcut for editor.action.openLink which will click the link that the caret is on, and operators can be chosen by typing the first couple characters of their names.  This can be a lot faster than using the mouse!