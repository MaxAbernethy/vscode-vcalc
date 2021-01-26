'use strict';
import { ExtensionContext, CancellationToken, DecorationOptions, Disposable, DocumentLink, DocumentLinkProvider,
    OutputChannel, Position, QuickPickItem, QuickPickOptions, Range, TextDocument, TextEditorDecorationType, TextEditorEdit, TextEditor, Uri, 
    languages, commands, window, EndOfLine,  } from 'vscode';

let vscode = require('vscode');

// Scalar, vector, or matrix. Matrices are stored in column-major order
class Value extends Array<number>
{
    constructor(x: number[] = [0], rows: number = x.length)
    {
        super(x.length);
        for (let i = 0; i < x.length; i++)
        {
            this[i] = x[i];
        }
        this.rows = rows;
    }

    static scalar(x: number) : Value
    {
        return new Value([x]);
    }

    static get invalid() : Value
    {
        return new Value([], 0);
    }

    get valid()
    {
        return this.rows > 0;
    }

    get dimensions(): number
    {
        if (this.length === 1)
        {
            return 0;
        }
        if (this.length === this.rows)
        {
            return 1;
        }
        if (this.length % this.rows === 0)
        {
            return 2;
        }
        return -1; // invalid
    }

    get cols(): number
    {
        return this.length / this.rows;
    }

    col(i: number): Value
    {
        return new Value(this.slice(i * this.rows, (i + 1) * this.rows));
    }

    index(row: number, col: number)
    {
        return col * this.rows + row;
    }

    entry(row: number, col: number): number
    {
        return this[this.index(row, col)];
    }

    rows: number;
}

enum ValueMode
{
    Decimal,
    Hexadecimal
}

// Print a Value either as hex or dec
function stringify(x:Value, mode: ValueMode): string
{
    function stringifyScalar(x:number, mode:ValueMode)
    {
        switch (mode)
        {
            case ValueMode.Decimal: return x.toString();
            case ValueMode.Hexadecimal: return '0x' + ('00000000' + x.toString(16)).substr(-8);
        }
    }

    function stringifyVector(x:number[], mode:ValueMode)
    {
        let vector = '(';
        for (let i = 0; i < x.length; i++)
        {
            vector += stringifyScalar(x[i], mode);
            if (i < x.length - 1)
            {
                vector += ', ';
            }
        }
        return vector + ')';
    }

    switch(x.dimensions)
    {
        case 0: return stringifyScalar(x[0], mode);
        case 1: return stringifyVector(x, mode);
        case 2:
        {
            let matrix = '(';
            for (let i = 0; i < x.cols; i++)
            {
                matrix += stringifyVector(x.col(i), mode);
                if (i < x.cols - 1)
                {
                    matrix += ', ';
                }
            }
            return matrix + ')';
        }
        default: return 'error';
    }
}

// Apply a scalar binary operator to two values, pairwise if one or both has dimension > 1
// Returns Value.invalid if neither a nor b is scalar and they don't have the same number of rows and cols
// (So, for example, if you try to add a vector to a matrix, it will not work).
function opPairs(a:Value, b:Value, op:(a:number, b:number)=>number): Value
{
    // Check type compatibility -- requires equal dimension matrices, equal length vectors, or at least one scalar
    if ((a.length !== b.length || a.rows !== b.rows) && a.dimensions !== 0 && b.dimensions !== 0)
    {
        return Value.invalid;
    }

    // Apply op
    let result:number[] = [];
    let length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i++)
    {
        result.push(op(a[i % a.length], b[i % b.length]));
    }

    return new Value(result, Math.max(a.rows, b.rows));
}

// Multiplies a vector or matrix by a vector or matrix.
// Returns Value.invalid if left's cols do not match right's rows.
function matrixMultiply(left:Value, right:Value): Value
{
    if (left.cols !== right.rows)
    {
        return Value.invalid;
    }
    
    let result: number[] = [];
    for (let i = 0; i < right.cols; i++)
    {
        for (let j = 0; j < left.rows; j++)
        {
            let sum = 0;
            for (let k = 0; k < left.cols; k++)
            {
                sum += left.entry(j, k) * right.entry(k, i);
            }
            result.push(sum);
        }
    }
    return new Value(result, left.rows);
}

// Returns the magnitude of a vector, or Value.invalid if x is not a vector
function magnitude(x: Value): Value
{
    if (x.dimensions !== 1)
    {
        return Value.invalid;
    }

    let lengthSquared = 0;
    for (let i = 0; i < x.length; i++)
    {
        lengthSquared += x[i] * x[i];
    }
    return Value.scalar(Math.sqrt(lengthSquared));
}

// Applies a unary operator to every element of a Value
function unary(x:Value, op:(x:number) => number): Value
{
    let y: number[] = [];
    x.forEach(function(x: number) { y.push(op(x)); });
    return new Value(y, x.rows);
}

// Collection of simple unary operators
let square = (x:Value) => unary(x, (x:number) => x * x);
let sqrt = (x:Value) => unary(x, (x:number) => Math.sqrt(x));
let reciprocal = (x:Value) => unary(x, (x:number) => 1.0 / x);
let negate = (x:Value) => unary(x, (x:number) => -x);
let abs = (x:Value) => unary(x, (x:number) => Math.abs(-x));
let sin = (x:Value) => unary(x, (x:number) => Math.sin(x));
let cos = (x:Value) => unary(x, (x:number) => Math.cos(x));
let tan = (x:Value) => unary(x, (x:number) => Math.tan(x));
let asin = (x:Value) => unary(x, (x:number) => Math.asin(x));
let acos = (x:Value) => unary(x, (x:number) => Math.acos(x));
let atan = (x:Value) => unary(x, (x:number) => Math.atan(x));
let rad2deg = (x:Value) => unary(x, (x:number) => x * 180.0 / Math.PI);
let deg2rad = (x:Value) => unary(x, (x:number) => x * Math.PI / 180.0);

// Normalizes a vector, or returns Value.invalid if x is not a vector
function normalize(x:Value): Value
{
    if (x.dimensions !== 1)
    {
        return Value.invalid;
    }
    let invLength = 1.0 / magnitude(x)[0];
    return unary(x, (x: number) => x * invLength);
}

// Returns the dot product of two vectors, or Value.invalid if the values
// are not both vectors of equal length.
function dot(a:Value, b:Value): Value
{
    if (a.length !== b.length || a.dimensions !== 1 || b.dimensions !== 1)
    {
        return Value.invalid;
    }

    let sum = 0;
    let length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i++)
    {
        sum += a[i] * b[i];
    }
    return Value.scalar(sum);
}

// Returns the cross product of two vectors, or Value.invalid if the values
// are not both 3-vectors
function cross(a:Value, b:Value): Value
{
    if (a.dimensions !==1 || b.dimensions !== 1 || a.length !== 3 || b.length !== 3)
    {
        return Value.invalid;
    }

    return new Value([
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ]);
}

// Returns a transposed value.
// Notes: if x is a scalar this returns the same scalar.
// If x is an N-vector this returns a 1xN matrix, as there is no concept
// of row vector here.
function transpose(x: Value) : Value
{
    let y = new Value(x, x.cols);
    for (let i = 0; i < x.rows; i++)
    {
        for (let j = 0; j < x.cols; j++)
        {
            y[y.index(j, i)] = x.entry(i, j);
        }
    }
    return y;
}

enum ParseNodeType
{
    List,
    Scalar,
    Vector,
    Matrix
};

// A node in the parse tree for a line of text.
// It can represent either a scalar, a vector, a matrix, or a list of nodes.
// It includes the range of characters in the line that comprise the node, a list
// of child nodes, and if applicable the type of delimiter that would end the node.
class ParseNode
{
    constructor(begin: number, delim: string)
    {
        this.begin = begin;
        switch (delim)
        {
            case '{': this.delim = '}'; break;
            case '[': this.delim = ']'; break;
            case '(': this.delim = ')'; break;
        }
    }

    close(end: number, parent: ParseNode)
    {
        // Remove this if it's empty
        this.end = end;
        if (this.items.length === 0)
        {
            return;
        }

        // Check for uniformity of children
        let type = this.items[0].type;
        let count = this.items[0].items.length;
        for (let i = 1; i < this.items.length; i++)
        {
            if (this.items[i].type !== type)
            {
                type = ParseNodeType.List;
            }
            if (this.items[i].items.length !== count)
            {
                count = -1;
            }
        }

        // Check if this is a list of scalars or a list of vectors with the same length
        if (type === ParseNodeType.Scalar)
        {
            if (this.items.length === 1)
            {
                // Convert 1-vector to scalar
                this.type = ParseNodeType.Scalar;
                this.begin = this.items[0].begin;
                this.end = this.items[0].end;
                this.items = [];
            }
            else
            {
                // N-vector
                this.type = ParseNodeType.Vector;
            }
        }
        else if (type === ParseNodeType.Vector && count > 1)
        {
            if (this.items.length === 1)
            {
                // Convert Nx1 matrix to vector
                this.type = ParseNodeType.Vector;
                this.begin = this.items[0].begin;
                this.end = this.items[0].end;
                this.items = this.items[0].items;
            }
            else
            {
                // NxM matrix
                this.type = ParseNodeType.Matrix;
            }
        } // else type remains none

        if (parent !== null)
        {
            parent.items.push(this);
        }
    }

    type: ParseNodeType = ParseNodeType.List;
    begin: number = -1;
    end: number = -1;
    delim: string = '';
    items: ParseNode[] = [];
}

// Parses a line of text to find numerical values and returns them in a tree.
// For example if the line contains two 3-vectors, the tree will consist of a list node
// with one child for each of the vectors, each of which has one child for each element.
function parse(line: string): ParseNode
{
    let nodes:ParseNode[] = [new ParseNode(0, '')];
    let i:number = 0;
    let valid:boolean = true;
    while (i < line.length)
    {
        let c = line[i];

        if ('[({'.indexOf(c) >= 0)
        {
            // Opening delimiter - create a new node
            nodes.push(new ParseNode(i, c));
            valid = true;
        }
        else if (c === nodes[nodes.length - 1].delim)
        {
            // Closing delimiter - close a node
            let node = nodes.pop();
            if (node) // should always be defined, but TS complains
            {
                node.close(i + 1, nodes[nodes.length - 1]);
            }
            valid = true;
        }
        else if (valid)
        {
            // Alphabetic character - wait for a non-alphanumeric
            if (c.search(/[a-zA-Z]/) >= 0)
            {
                valid = false;
            }

            // Numeric character or sign - try to consume a number
            if (c.search(/[0-9-]/) >= 0)
            {
                // Search the line beginning from the current position
                // Match: beginning of string, [2]hex or [3]dec with optional [4]exponent, [5]non-alphanumeric or end of string
                let match = line.substr(i).match(/^((0x[0-9A-Fa-f]+)|(-?\d+\.?\d*(e[+-]?\d+)?f?))([^a-zA-Z0-9]|$)/);
                if (match !== null)
                {
                    let next = i + match[0].length - match[5].length;
                    let number = new ParseNode(i, '');
                    number.end = next;
                    number.type = ParseNodeType.Scalar;
                    nodes[nodes.length - 1].items.push(number);
                    i = next;
                    continue;
                }
                else
                {
                    valid = false;
                }
            }
        }
        else if (c.search(/[^a-zA-Z0-9-]/) >= 0)
        {
            valid = true;
        }

        i++;
    }

    // Shed singleton lists
    let node = nodes[nodes.length - 1];
    while (node.type === ParseNodeType.List && node.items.length === 1)
    {
        node = node.items[0];
    }
    return node;
}

class ContentProvider implements DocumentLinkProvider
{
    constructor()
    {
        // Set up decorations
        this.scalarDecorationType = window.createTextEditorDecorationType({ color : "#9cdcfe" });
        this.vectorDecorationType = window.createTextEditorDecorationType({ color : "#dcdcaa" });
        this.matrixDecorationType = window.createTextEditorDecorationType({ color : "#c586c0" });

        // Set up text output
        this.channel = window.createOutputChannel('vcalc');
    }

    onDidChangeVisibleTextEditors(editors: TextEditor[]): void
    {
        // Apply text decorations to inactive regions
        for (const e of editors)
        {
            this.parse(e.document, e, undefined);
        }
    }

    provideDocumentLinks(document: TextDocument, token: CancellationToken): DocumentLink[]
    {
        // Check if this document belongs to a visible text editor
        let editor: TextEditor|undefined = undefined;
        for (const e of window.visibleTextEditors)
        {
            if (e.document === document)
            {
                editor = e;
                break;
            }
        }

        return this.parse(document, editor, token);
    }
    
    // Parses every line of the document for numerical values and converts them to colored links
    parse(document: TextDocument, editor: TextEditor|undefined, token: CancellationToken|undefined): DocumentLink[]
    {
        let scalarDecorations : DecorationOptions[] = [];
        let vectorDecorations : DecorationOptions[] = [];
        let matrixDecorations : DecorationOptions[] = [];
        let links: DocumentLink[] = [];
        for (let i = 0; i < document.lineCount; i++)
        {
            if (token && token.isCancellationRequested)
            {
                return [];
            }

            // Parse the line and generate links for its values
            let line = document.lineAt(i).text;
            function linkify(node:ParseNode)
            {
                if (node.type === ParseNodeType.List)
                {
                    // Recursively linkify children
                    node.items.forEach((child: ParseNode) => { linkify(child); });
                }
                else
                {
                    // Linkify the text
                    let begin = new Position(i, node.begin);
                    let end = new Position(i, node.end);
                    let range = new Range(begin, end);
                    let commandUri = 'command:vectorcalculator.setOperand?' + JSON.stringify([begin, end]);
                    links.push(new DocumentLink(range, Uri.parse(commandUri)));

                    // Add decoration
                    if (editor)
                    {
                        switch (node.type)
                        {
                            case ParseNodeType.Scalar: scalarDecorations.push({ range: range, hoverMessage: 'scalar' }); break;
                            case ParseNodeType.Vector: vectorDecorations.push({ range: range, hoverMessage: 'vector' + node.items.length }); break;
                            case ParseNodeType.Matrix: matrixDecorations.push({ range: range, hoverMessage: 'matrix' + node.items[0].items.length + 'x' + node.items.length }); break;
                            default: break;
                        }
                    }
                }
            }
            linkify(parse(line));
        }

        // Apply decorations
        if (editor)
        {
            editor.setDecorations(this.scalarDecorationType, scalarDecorations);
            editor.setDecorations(this.vectorDecorationType, vectorDecorations);
            editor.setDecorations(this.matrixDecorationType, matrixDecorations);
        }
        return links;
    }

    report(message: string)
    {
        window.showInformationMessage('vcalc: ' + message);
        this.channel.appendLine(message);
    }

    // GUI to input an operand that is not in the text.
    // Values can be in the same format as in the text, but there is also a list of constants
    // to choose from that are not recognized in the text.
    async inputOperand()
    {
        // Clear unless awaiting a second operand
        if (this.operator === '')
        {
            this.clear();
        }

        // Make a list of preset constants
        let consts = new Map<string, string>();
        consts.set('e', Math.E.toString());
        consts.set('epsilon', (1.0 / 8388608).toString()); // 32-bit floating point epsilon, 2^-23
        consts.set('pi', Math.PI.toString());
        consts.set('sqrt2', Math.sqrt(2).toString());
        consts.set('sqrt3', Math.sqrt(3).toString());
        consts.set('i', '(1, 0, 0)');
        consts.set('j', '(0, 1, 0)');
        consts.set('k', '(0, 0, 1)');

        let constPicks: QuickPickItem[] = [];
        consts.forEach((value: string, key: string) =>
        {
            constPicks.push({label: key, description: value});
        });

        // Let the user pick a constant or enter a value
        const quickPick = window.createQuickPick();
        quickPick.placeholder = 'Input a named constant (eg. pi, sqrt2) or other value (eg. 123, (1, 2, 3))';
        quickPick.canSelectMany = false;
        quickPick.items = constPicks;
        quickPick.onDidAccept(() =>
        {
            let operand = quickPick.activeItems[0];
            if (operand === undefined)
            {
                // Clear the state
                this.clear();
            }
            else
            {
                // Check for preset constants
                let operandStr = operand.description;
                if (operandStr === undefined || operandStr.length === 0)
                {
                    operandStr = operand.label;
                }

                // Set the operand
                this.setOperandStr(operandStr);
            }
            quickPick.hide();
        });

        // QuickPick only lets you choose from its list of items, but while we want to provide
        // a navigable list of suggestions, we also want to allow any value to be entered.  So,
        // when the value that the user does not match anything in the list, it is just added
        // as the first item in the list so that it can be selected.
        quickPick.onDidChangeValue(() =>
        {
            if (quickPick.value.length === 0 || quickPick.value[0].match(/[a-zA-Z]/))
            {
                // Entering a named constant
                quickPick.items = constPicks;
            }
            else
            {
                // Entering a value
                quickPick.items = [{ label: quickPick.value }, ...constPicks];
            }
        });
        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.show();
    }

    // Chooses an operand from the text.
    // This saves the range in the text that the value came from so that it can be overwritten
    // by the replace operator later.
    async setOperand(range: Range)
    {
        // Fetch the string from the document
        if (!window.activeTextEditor)
        {
            return;
        }
        let doc = window.activeTextEditor.document;
        let operandStr = doc.getText(range);

        // Save the source so that we can overwrite it later
        if (!this.operand.valid)
        {
            this.sourceRange = range;
            this.sourceString = operandStr;
        }

        this.setOperandStr(operandStr);
    }
    
    // Inputs an operand.
    // If there is a binary operator waiting for a second operand, that operation will be completed with the provided value
    // and the result will be selected.  Otherwise, the provided value is selected.  Either way, the user is presented with
    // a list of possible operators on the selected value.  If the user...
    // - selects a unary operator: it is immediately applied.  If it is an output operator like copy or append then the state
    //   is cleared; otherwise, the result of the operation is selected and a new list of operators is shown.
    // - selects a binary operator: the operand and operator are saved until the user inputs another operand
    // - does not select an operator: the state is reset
    async setOperandStr(operandStr: string)
    {
        // Parse the operand
        let x: number[] = [];
        let allHex: boolean = (this.operand.length === 0 || this.mode === ValueMode.Hexadecimal);
        function enumerate(node: ParseNode)
        {
            if (node.type === ParseNodeType.Scalar)
            {
                let numberStr = operandStr.substr(node.begin, node.end - node.begin);
                if (numberStr.substr(0, 2) === '0x')
                {
                    x.push(parseInt(numberStr));
                }
                else
                {
                    x.push(parseFloat(numberStr));
                    allHex = false;
                }
            }
            else
            {
                node.items.forEach((node: ParseNode) => enumerate(node));
            }
        }
        let tree = parse(operandStr); 
        enumerate(tree);
        this.mode = (allHex ? ValueMode.Hexadecimal : ValueMode.Decimal);
        let rows: number;
        switch(tree.type)
        {
            case ParseNodeType.Scalar: rows = 1; break;
            case ParseNodeType.Vector: rows = x.length; break;
            case ParseNodeType.Matrix: rows = x.length / tree.items.length; break;
            default:
                this.report('error');
                this.clear();
                return;
        }
        let operand = new Value(x, rows);

        // If there was an operation in progress, complete it
        let result: Value;
        switch(this.operator)
        {
            // Arithmetic -- except for matrix-matrix and matrix-vector multiply, all are done component-wise
            case 'add': result = opPairs(this.operand, operand, function(a:number, b:number):number { return a + b; }); break;
            case 'subtract': result = opPairs(this.operand, operand, function(a:number, b:number):number { return a - b; }); break;
            case 'divide': result = opPairs(this.operand, operand, function(a:number, b:number):number { return a / b; }); break;
            case 'multiply':
            {
                if (this.operand.dimensions === 2 && operand.dimensions !== 0)
                {
                    // matrix times matrix or vector
                    result = matrixMultiply(this.operand, operand);
                }
                else if (operand.dimensions === 2 && this.operand.dimensions !== 0)
                {
                    // vector times matrix, just reverse the order so it works
                    result = matrixMultiply(operand, this.operand);
                }
                else
                {
                    result = opPairs(this.operand, operand, function(a:number, b:number):number { return a * b; });
                }
                break;
            }

            // Linear algebra
            case 'dot': result = dot(this.operand, operand); break;
            case 'cross': result = cross(this.operand, operand); break;

            default: result = operand;
        }

        // Check for an error, eg. mismatched operands
        if (!result.valid)
        {
            this.report('error');
            this.clear();
            return;
        }

        // Decide what to do next
        let binaryOperator = true;
        while (true)
        {
            // Show the current value
            let resultStr = stringify(result, this.mode);
            let message: string;
            if (this.operator.length === 0)
            {
                message = 'Select ' + resultStr;
            }
            else if (binaryOperator)
            {
                message = stringify(this.operand, this.mode) + ' ' + this.operator + ' ' + stringify(operand, this.mode) + ' = ' + resultStr;
            }
            else
            {
                message = this.operator + ' ' + stringify(this.operand, this.mode) + ' = ' + resultStr;
            }
            this.report(message);
            binaryOperator = false;

            // Build the operator list
            let operators: QuickPickItem[] = [];

            // Output operations
            operators.push({ label: 'copy', description: resultStr });
            operators.push({ label: 'append', description: resultStr });
            operators.push({ label: 'replace', description: resultStr });

            // Mode operations
            let isIntegral: boolean = true;
            for (let i = 0; i < result.length; i++)
            {
                if (!Number.isInteger(result[i]) || result[i] < 0 || result[i] > 0xffffffff)
                {
                    isIntegral = false;
                }
            }
            if (isIntegral)
            {
                switch (this.mode)
                {
                    case ValueMode.Decimal:
                        operators.push({ label: 'hex32', description: stringify(result, ValueMode.Hexadecimal)});
                        break;
                    case ValueMode.Hexadecimal:
                        operators.push({ label: 'decimal', description: stringify(result, ValueMode.Decimal)});
                        break;
                }
            }

            if (result.dimensions === 1)
            {
                // Vector operations
                let labels = ['x', 'y', 'z', 'w'];
                for (let i = 0; i < Math.min(result.length, labels.length); i++)
                {
                    operators.push({ label: labels[i], description : result[i].toString()});
                }
                if (result.length > 3)
                {
                    operators.push({ label: 'xyz', description : result.slice(0, 3).toString()});
                }
                operators.push({ label: 'length', description: stringify(magnitude(result), this.mode) });
                operators.push({ label: 'normalize', description: stringify(normalize(result), this.mode) });
                operators.push({ label: 'dot' });
                if (result.length === 3)
                {
                    operators.push({ label: 'cross' });
                }
            }
            else if (result.dimensions === 2)
            {
                // Matrix operations
                for (let i = 0; i < result.cols; i++)
                {
                    operators.push({ label: 'col' + i, description: stringify(result.col(i), this.mode)});
                }
                operators.push({ label: 'transpose', description: stringify(transpose(result), this.mode)});
            }

            // Common binary operations
            operators.push({ label: 'add' });
            operators.push({ label: 'subtract' });
            operators.push({ label: 'multiply' });
            operators.push({ label: 'divide' });

            // Common unary operations
            let unaryOp = (label: string, op: (x: Value) => Value) => 
            {
                return { label: label, description: stringify(op(result), this.mode) };
            };
            operators.push(unaryOp('square', square));
            operators.push(unaryOp('sqrt', sqrt));
            operators.push(unaryOp('reciprocal', reciprocal));
            operators.push(unaryOp('negate', negate));
            operators.push(unaryOp('abs', abs));
            operators.push(unaryOp('sin', sin));
            operators.push(unaryOp('cos', cos));
            operators.push(unaryOp('tan', tan));
            operators.push(unaryOp('asin', asin));
            operators.push(unaryOp('acos', acos));
            operators.push(unaryOp('atan', atan));
            operators.push(unaryOp('rad->deg', rad2deg));
            operators.push(unaryOp('deg->rad', deg2rad));

            // Choose an operator
            let operandDesc = '';
            switch (operand.dimensions)
            {
                case 0: operandDesc = 'Scalar'; break;
                case 1: operandDesc = 'Vector' + operand.rows; break;
                case 2: operandDesc = 'Matrix' + operand.rows + 'x' + operand.cols; break;
            }
            let operator = await window.showQuickPick(operators, {placeHolder: operandDesc + ' operator'});
            if (operator === undefined)
            {
                // Clear the state
                this.clear();
                return;
            }

            // Save the result and operator
            this.operator = operator.label;
            this.operand = result;

            // Handle unary operators
            switch (operator.label)
            {
                // Vector component selection
                case 'x': result = Value.scalar(result[0]); continue;
                case 'y': result = Value.scalar(result[1]); continue;
                case 'z': result = Value.scalar(result[2]); continue;
                case 'w': result = Value.scalar(result[3]); continue;
                case 'xyz': result = new Value(result.slice(0, 3)); continue;
                
                case 'length': result = magnitude(result); continue;
                case 'normalize': result = normalize(result); continue;
                case 'transpose': result = transpose(result); continue;

                case 'square': result = square(result); continue;
                case 'sqrt': result = sqrt(result); continue;
                case 'reciprocal': result = reciprocal(result); continue;
                case 'negate': result = negate(result); continue;
                case 'abs': result = abs(result); continue;
                case 'sin': result = sin(result); continue;
                case 'cos': result = cos(result); continue;
                case 'tan': result = tan(result); continue;
                case 'asin': result = asin(result); continue;
                case 'acos': result = acos(result); continue;
                case 'atan': result = atan(result); continue;
                case 'rad->deg': result = rad2deg(result); continue;
                case 'deg->rad': result = deg2rad(result); continue;

                // Output
                case 'copy':
                    vscode.env.clipboard.writeText(stringify(result, this.mode));
                    this.clear();
                    break;

                case 'append':
                    
                    if (window.activeTextEditor)
                    {
                        let doc = window.activeTextEditor.document;
                        let position: Position = new Position(doc.lineCount, doc.lineAt(doc.lineCount - 1).text.length);
                        let eol: string = (doc.eol === EndOfLine.CRLF ? '\r\n' : '\n');
                        let edited = await window.activeTextEditor.edit(function(editBuilder: TextEditorEdit)
                        {
                            editBuilder.insert(position, eol + resultStr);
                        });
                        if (edited)
                        {
                            this.clear();
                            break;
                        }
                    }
                    this.report('error, could not insert');
                    this.clear();
                    return;
                    
                case 'replace':
                    
                    if (window.activeTextEditor)
                    {
                        let doc = window.activeTextEditor.document;

                        // Check that the source text didn't change
                        let range = this.sourceRange;
                        if (doc.getText(range) !== this.sourceString)
                        {
                            this.report('error, could not replace - the document changed');
                            this.clear();
                            return;
                        }

                        // Replace the source text with the result
                        let edited = await window.activeTextEditor.edit(function(editBuilder: TextEditorEdit)
                        {
                            editBuilder.replace(range, resultStr);
                        });
                        if (edited)
                        {
                            this.clear();
                            break;
                        }
                    }
                    this.report('error, could not replace');
                    this.clear();
                    return;

                // Mode
                case 'decimal': this.mode = ValueMode.Decimal; continue;
                case 'hex32': this.mode = ValueMode.Hexadecimal; continue;

                default:
                    // Special case: column operator
                    {
                        let colMatch = operator.label.match(/^col(\d+)$/);
                        if (colMatch !== null)
                        {
                            result = result.col(parseInt(colMatch[1]));
                            continue;
                        }
                    }

                    // Binary operator, wait for another operand
                    break;
            }

            // Show the current value and operator
            if (this.operand.length > 0)
            {
                this.report(stringify(this.operand, this.mode) + ' ' + this.operator + ' ...');
            }

            return;
        }

        // Clear the state
        this.clear();
    }

    // Reset the state, cancelling any pending operator
    clear()
    {
        this.operand = Value.invalid;
        this.operator = '';
        this.sourceString = '';
    }

    // Currently selected operand / operator
    operand: Value = Value.invalid;
    operator: string = '';
    mode: ValueMode = ValueMode.Decimal;

    // Location in the document of the first operand of the current chain of operations
    sourceRange: Range = new Range(new Position(0, 0), new Position(0, 0));
    sourceString: String = '';

    // Styling
    scalarDecorationType: TextEditorDecorationType;
    vectorDecorationType: TextEditorDecorationType;
    matrixDecorationType: TextEditorDecorationType;

    // Console output
    channel: OutputChannel;
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: ExtensionContext)
{
    const provider = new ContentProvider();

	// register document link provider for scheme
	context.subscriptions.push(Disposable.from(
        languages.registerDocumentLinkProvider({ language:'plaintext' }, provider)
	));

    // Register command callbacks
    context.subscriptions.push(commands.registerCommand('vectorcalculator.setOperand', (begin: Position, end: Position) => {
        let range = new Range(new Position(begin.line, begin.character), new Position(end.line, end.character));
        provider.setOperand(range);
    }));
    context.subscriptions.push(commands.registerCommand('vectorcalculator.inputOperand', () => provider.inputOperand()));

    // Register for notification when editor visibility changes
    context.subscriptions.push(window.onDidChangeVisibleTextEditors((editors: TextEditor[]) => provider.onDidChangeVisibleTextEditors(editors)));
}

// this method is called when your extension is deactivated
export function deactivate() {
}