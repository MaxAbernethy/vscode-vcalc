# vectorcalculator

This extension allows you to do basic linear algebra operations in-editor.

## Inputs
The extension identifies numbers in plaintext documents and linkifies them.
* Individual numbers are interpreted as scalars.
* Comma-separated lists of 2, 3, or 4 numbers are interpreted as vectors.
* Comma-separated lists of 9, 16, 25, etc. numbers are interpreted as square column-major matrices.

## Operations
When you click a link, its value is selected and a list of operations is shown.  If you choose a unary operator, like length or reciprocal, then the result is immediately selected.  If you choose a binary operator, like add or dot, then the result will be selected after you choose another operand by clicking its link.

## Outputs
There are three ways to access the results of your operations.
* You can use the copy operator to move the selected value to the clipboard
* You can use the append operator to write the selected value to the end of the document
* All operands and results are logged in the vcalc channel of the output panel.
