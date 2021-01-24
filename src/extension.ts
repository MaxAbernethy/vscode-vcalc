/* eslint-disable @typescript-eslint/naming-convention */
'use strict';
import { ExtensionContext, CancellationToken, DecorationOptions, Disposable, DocumentLink, DocumentLinkProvider,
    OutputChannel, Position, QuickPickItem, Range, TextDocument, TextEditorDecorationType, TextEditorEdit, Uri, 
    languages, commands, window, EndOfLine,  } from 'vscode';

let vscode = require('vscode');

class ValueType
{
    constructor(dimensions:number, length:number)
    {
        this.dimensions = dimensions;
        this.length = length;
    }

    valid():boolean
    {
        return (this.length > 0);
    }

    dimensions:number = 0;  // 0 scalar, 1 vector, 2 matrix
    length:number = 0;
}

enum ValueMode
{
    Decimal,
    Hexadecimal
}

function getType(length:number) : ValueType
{
    // Scalar
    if (length === 1)
    {
        return new ValueType(0, 1);
    }

    // 2-, 3-, or 4- Vector
    if (length <= 4)
    {
        return new ValueType(1, length);
    }

    // NxN matrix, n >= 3
    let sqrt = Math.sqrt(length);
    if (sqrt === Math.floor(sqrt))
    {
        return new ValueType(2, sqrt);
    }

    return new ValueType(0, 0); // invalid
}

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

function stringify(x:number[], mode: ValueMode): string
{
    let type = getType(x.length);
    switch(type.dimensions)
    {
        case 0: return stringifyScalar(x[0], mode);
        case 1: return stringifyVector(x, mode);
        case 2:
        {
            let matrix = '(';
            for (let i = 0; i < type.length; i++)
            {
                matrix += stringifyVector(x.slice(i * type.length, (i + 1) * type.length), mode);
                if (i < type.length - 1)
                {
                    matrix += ', ';
                }
            }
            return matrix + ')';
        }
        default: return 'error';
    }
}

function opPairs(a:number[], b:number[], op:(a:number, b:number)=>number): number[]
{
    // Check type compatibility
    let typeA = getType(a.length);
    let typeB = getType(b.length);
    if (typeA.length !== typeB.length && typeA.dimensions !== 0 && typeB.dimensions !== 0)
    {
        return [];
    }

    // Apply op
    let result:number[] = [];
    let length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i++)
    {
        result.push(op(a[i % a.length], b[i % b.length]));
    }
    return result;
}

function matrixMultiply(m:number[], x:number[]): number[]
{
    let typeM = getType(m.length);
    let typeX = getType(x.length);

    if (typeM.length !== typeX.length)
    {
        return [];
    }

    let result: number[] = [];
    for (let i = 0; i < x.length; i++)
    {
        let offsetM = i % typeM.length;
        let offsetX = Math.floor(i / typeM.length) * typeM.length;
        let sum = 0;
        for (let j = 0; j < typeM.length; j++)
        {
            sum += m[offsetM + j * typeM.length] * x[offsetX + j];
        }
        result.push(sum);
    }
    return result;
}

function magnitude(x:number[]):number
{
    let lengthSquared = 0;
    for (let i = 0; i < x.length; i++)
    {
        lengthSquared += x[i] * x[i];
    }
    return Math.sqrt(lengthSquared);
}

function unary(x:number[], op:(x:number) => number)
{
    let y: number[] = [];
    x.forEach(function(x: number) { y.push(op(x)); });
    return y;
}

let square = (x:number[]) => unary(x, (x:number) => x * x);
let sqrt = (x:number[]) => unary(x, (x:number) => Math.sqrt(x));
let reciprocal = (x:number[]) => unary(x, (x:number) => 1.0 / x);
let negate = (x:number[]) => unary(x, (x:number) => -x);
let sin = (x:number[]) => unary(x, (x:number) => Math.sin(x));
let cos = (x:number[]) => unary(x, (x:number) => Math.cos(x));
let tan = (x:number[]) => unary(x, (x:number) => Math.tan(x));
let asin = (x:number[]) => unary(x, (x:number) => Math.asin(x));
let acos = (x:number[]) => unary(x, (x:number) => Math.acos(x));
let atan = (x:number[]) => unary(x, (x:number) => Math.atan(x));
let rad2deg = (x:number[]) => unary(x, (x:number) => x * 180.0 / Math.PI);
let deg2rad = (x:number[]) => unary(x, (x:number) => x * Math.PI / 180.0);

function normalize(x:number[]): number[]
{
    let invLength = 1.0 / magnitude(x);
    let n: number[] = [];
    x.forEach(function(x: number) { n.push(x * invLength); });
    return n;
}

function dot(a:number[], b:number[]): number[]
{
    let typeA = getType(a.length);
    let typeB = getType(b.length);
    if (typeA.length !== typeB.length && typeA.dimensions !== 0 && typeB.dimensions !== 0)
    {
        return [];
    }

    let sum = 0;
    let length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i++)
    {
        sum += a[i % a.length] * b[i % b.length];
    }
    return [sum];
}

function cross(a:number[], b:number[]): number[]
{
    if (a.length !== 3 || b.length !== 3)
    {
        return [];
    }

    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

function column(m:number[], c: number) : number[]
{
    let type = getType(m.length);
    if (type.dimensions !== 2 || c !== Math.floor(c) || c < 0 || c >= type.length)
    {
        return [];
    }

    let start = type.length * c;
    return m.slice(start, start + type.length);
}

function transpose(m:number[]) : number[]
{
    let type = getType(m.length);
    if (type.dimensions !== 2)
    {
        return [];
    }

    let result: number[] = [];
    for (let i = 0; i < type.length; i++)
    {
        for (let j = 0; j < type.length; j++)
        {
            result.push(m[i + j * type.length]);
        }
    }

    return result;
}


enum ParseNodeType
{
    None,
    Scalar,
    Vector,
    Matrix
};

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
                type = ParseNodeType.None;
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

    type: ParseNodeType = ParseNodeType.None;
    begin: number = -1;
    end: number = -1;
    delim: string = '';
    items: ParseNode[] = [];
}

function parse(line: string)
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
        else if (c.search(/[^a-zA-Z0-9-]/))
        {
            valid = true;
        }

        i++;
    }

    return nodes[nodes.length - 1];
}

class ContentProvider implements DocumentLinkProvider
{
    constructor()
    {
        // Initialize regular expressions
        // numberExprStr = non-alphanumeric or beginning of string, ((hexadecimal number) or (decimal number))
        //      (exponent) = e, maybe sign, digits
        //   (hexadecimal number) = match[4] = 0x, hex digits
        //   (decimal number) = match[5] = maybe sign, digits, point, maybe more digits, maybe (exponent), maybe f
        let numberExprStr = "(([^a-zA-Z0-9]|^)((0x[0-9A-Fa-f]+)|(-?\\d+\\.?\\d*(e[+-]?\\d+)?f?)))";
        this.numberExpr = new RegExp(numberExprStr, 'g');
        let sepExprStr = "[()[\\]{}=\\s]";
        this.leadingSeparatorExpr = new RegExp("^" + sepExprStr + "*");
        this.trailingSeparatorExpr = new RegExp(sepExprStr + "*$");
        let arrayExprStr = "(^|" + sepExprStr + "*)" + numberExprStr + "(" + sepExprStr + "*," + sepExprStr + "*" + numberExprStr + ")*";
        this.arrayExpr = new RegExp(arrayExprStr, 'g');

        // Set up decorations
        this.scalarDecorationType = window.createTextEditorDecorationType({ color : "#9cdcfe" });
        this.vectorDecorationType = window.createTextEditorDecorationType({ color : "#dcdcaa" });
        this.matrixDecorationType = window.createTextEditorDecorationType({ color : "#c586c0" });

        // Set up text output
        this.channel = window.createOutputChannel('vcalc');
    }

    provideDocumentLinks(document: TextDocument, token: CancellationToken): DocumentLink[]
    {
        let links: DocumentLink[] = [];
        let scalarDecorations : DecorationOptions[] = [];
        let vectorDecorations : DecorationOptions[] = [];
        let matrixDecorations : DecorationOptions[] = [];
        for (let i = 0; i < document.lineCount; i++)
        {
            // Parse the line and generate links for its values
            let line = document.lineAt(i).text;
            function linkify(node:ParseNode)
            {
                if (node.type === ParseNodeType.None)
                {
                    // Recursively linkify children
                    node.items.forEach((child: ParseNode) => { linkify(child); });
                }
                else
                {
                    // Linkify the text
                    let range = new Range(new Position(i, node.begin), new Position(i, node.end));
                    let commandUri = 'command:vectorcalculator.setOperand?' + JSON.stringify(line.substr(node.begin, node.end - node.begin));
                    links.push(new DocumentLink(range, Uri.parse(commandUri)));

                    // Add decoration
                    switch (node.type)
                    {
                        case ParseNodeType.Scalar: scalarDecorations.push({ range: range, hoverMessage: 'scalar' }); break;
                        case ParseNodeType.Vector: vectorDecorations.push({ range: range, hoverMessage: 'vector' + node.items.length }); break;
                        case ParseNodeType.Matrix: matrixDecorations.push({ range: range, hoverMessage: 'matrix' + node.items[0].items.length + 'x' + node.items.length }); break;
                        default: break;
                    }
                }
            }
            linkify(parse(line));
        }

        // Apply decorations
        if (window.activeTextEditor)
        {
            window.activeTextEditor.setDecorations(this.scalarDecorationType, scalarDecorations);
            window.activeTextEditor.setDecorations(this.vectorDecorationType, vectorDecorations);
            window.activeTextEditor.setDecorations(this.matrixDecorationType, matrixDecorations);
        }
        return links;
    }

    report(message: string)
    {
        window.showInformationMessage('vcalc: ' + message);
        this.channel.appendLine(message);
    }

    async setOperand(operandStr: string)
    {
        // Parse the operand
        let operand: number[] = [];
        let allHex: boolean = (this.operand.length === 0 || this.mode === ValueMode.Hexadecimal);
        function enumerate(node: ParseNode)
        {
            if (node.type === ParseNodeType.Scalar)
            {
                let numberStr = operandStr.substr(node.begin, node.end - node.begin);
                if (numberStr.substr(0, 2) === '0x')
                {
                    operand.push(parseInt(numberStr));
                }
                else
                {
                    operand.push(parseFloat(numberStr));
                    allHex = false;
                }
            }
            else
            {
                node.items.forEach((node: ParseNode) => enumerate(node));
            }
        }
        enumerate(parse(operandStr));
        this.mode = (allHex ? ValueMode.Hexadecimal : ValueMode.Decimal);

        // If there was an operation in progress, complete it
        let result: number[] = [];
        switch(this.operator)
        {
            // Arithmetic
            case 'add': result = opPairs(this.operand, operand, function(a:number, b:number):number { return a + b; }); break;
            case 'subtract': result = opPairs(this.operand, operand, function(a:number, b:number):number { return a - b; }); break;
            case 'divide': result = opPairs(this.operand, operand, function(a:number, b:number):number { return a / b; }); break;
            case 'multiply':
            {
                let typeA = getType(this.operand.length);
                let typeB = getType(operand.length);
                if (typeA.dimensions === 2 && typeB.dimensions !== 0)
                {
                    result = matrixMultiply(this.operand, operand);
                }
                else if (typeB.dimensions === 2 && typeA.dimensions !== 0)
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
        if (result.length === 0)
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
            let resultType = getType(result.length);

            // Output operations
            operators.push({ label: 'copy', description: resultStr });
            operators.push({ label: 'append', description: resultStr });

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

            if (resultType.dimensions === 1)
            {
                // Vector operations
                let labels = ['x', 'y', 'z', 'w'];
                for (let i = 0; i < resultType.length; i++)
                {
                    operators.push({ label: labels[i], description : result[i].toString()});
                }
                operators.push({ label: 'length', description: magnitude(result).toString() });
                operators.push({ label: 'normalize', description: stringify(normalize(result), this.mode) });
                operators.push({ label: 'dot' });
                if (result.length === 3)
                {
                    operators.push({ label: 'cross' });
                }
            }
            else if (resultType.dimensions === 2)
            {
                // Matrix operations
                for (let i = 0; i < resultType.length; i++)
                {
                    operators.push({ label: 'col' + i, description: stringify(column(result, i), this.mode)});
                }
                operators.push({ label: 'transpose', description: stringify(transpose(result), this.mode)});
            }

            // Common binary operations
            operators.push({ label: 'add' });
            operators.push({ label: 'subtract' });
            operators.push({ label: 'multiply' });
            operators.push({ label: 'divide' });

            // Common unary operations
            let unaryOp = (label: string, op: (x: number[]) => number[]) => 
            {
                return { label: label, description: stringify(op(result), this.mode) };
            };
            operators.push(unaryOp('square', square));
            operators.push(unaryOp('sqrt', sqrt));
            operators.push(unaryOp('reciprocal', reciprocal));
            operators.push(unaryOp('negate', negate));
            operators.push(unaryOp('sin', sin));
            operators.push(unaryOp('cos', cos));
            operators.push(unaryOp('tan', tan));
            operators.push(unaryOp('asin', asin));
            operators.push(unaryOp('acos', acos));
            operators.push(unaryOp('atan', atan));
            operators.push(unaryOp('rad->deg', rad2deg));
            operators.push(unaryOp('deg->rad', deg2rad));

            // Choose an operator
            let operator = await window.showQuickPick(operators);
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
                case 'x': result = [result[0]]; continue;
                case 'y': result = [result[1]]; continue;
                case 'z': result = [result[2]]; continue;
                case 'w': result = [result[3]]; continue;
                
                case 'length': result = [magnitude(result)]; continue;
                case 'normalize': result = normalize(result); continue;
                case 'transpose': result = transpose(result); continue;

                case 'square': result = square(result); continue;
                case 'sqrt': result = sqrt(result); continue;
                case 'reciprocal': result = reciprocal(result); continue;
                case 'negate': result = negate(result); continue;
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

                // Mode
                case 'decimal': this.mode = ValueMode.Decimal; continue;
                case 'hex32': this.mode = ValueMode.Hexadecimal; continue;

                default:
                    // Special case: column operator
                    {
                        let colMatch = operator.label.match(/^col(\d+)$/);
                        if (colMatch !== null)
                        {
                            let col = parseInt(colMatch[1]);
                            result = column(result, col);
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

    clear()
    {
        this.operand = [];
        this.operator = '';
    }

    // Currently selected operand / operator
    operand: number[] = [];
    operator: string = '';
    mode: ValueMode = ValueMode.Decimal;

    // Regular expressions
    numberExpr: RegExp;
    arrayExpr: RegExp;
    leadingSeparatorExpr: RegExp;
    trailingSeparatorExpr: RegExp;

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

	// register content provider for scheme `references`
	// register document link provider for scheme `references`
	const providerRegistrations = Disposable.from(
        languages.registerDocumentLinkProvider({ language:'plaintext' }, provider)
	);

    context.subscriptions.push(providerRegistrations);

    let disposable = commands.registerCommand('vectorcalculator.setOperand', (operand) => {
        provider.setOperand(operand);
    });
    
    context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {
}