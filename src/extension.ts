'use strict';
import { ExtensionContext, CancellationToken, DecorationOptions, Disposable, DocumentLink, DocumentLinkProvider,
    OutputChannel, Position, QuickPickItem, Range, TextDocument, TextEditorDecorationType, TextEditorEdit, Uri, 
    languages, commands, window, EndOfLine,  } from 'vscode';
let clipboardy = require('clipboardy');

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

function stringify(x:number[]): string
{
    let type = getType(x.length);
    switch(type.dimensions)
    {
        case 0: return x[0].toString();
        case 1: return '(' + x.join(', ') + ')';
        case 2:
        {
            let cols = '';
            for (let i = 0; i < type.length; i++)
            {
                cols += '(' + x.slice(i * type.length, (i + 1) * type.length).join(', ') + ')';
                if (i < type.length - 1)
                {
                    cols += ', ';
                }
            }
            return '(' + cols + ')';
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

function reciprocal(x:number[]): number[]
{
    let rcp: number[] = [];
    x.forEach(function(x: number) { rcp.push(1.0 / x); });
    return rcp;
}

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
            result.push(m[i + j * 4]);
        }
    }

    return result;
}

class ContentProvider implements DocumentLinkProvider
{
    constructor()
    {
        // Initialize regular expressions
        let numberExprStr = "(-?\\d+\\.?\\d*f?)";
        this.numberExpr = new RegExp(numberExprStr, 'g');
        let sepExprStr = "[()[\\]{}=\\s]";
        this.leadingSeparatorExpr = new RegExp("^" + sepExprStr + "*");
        this.trailingSeparatorExpr = new RegExp(sepExprStr + "*$");
        let arrayExprStr = "(^|" + sepExprStr + "*)" + numberExprStr + "(" + sepExprStr + "*," + sepExprStr + "*" + numberExprStr + ")*";
        this.arrayExpr = new RegExp(arrayExprStr, 'g');

        // Set up decorations
        this.scalarDecorationType = window.createTextEditorDecorationType({ color : "#00c0f0" });
        this.vectorDecorationType = window.createTextEditorDecorationType({ color : "#f000a0" });
        this.matrixDecorationType = window.createTextEditorDecorationType({ color : "#b0f000" });

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
            let line = document.lineAt(i).text;
            this.arrayExpr.lastIndex = 0; // reset the expression
            while (true)
            {
                // Search for an array of numbers on the line
                let match = this.arrayExpr.exec(line);
                if (match === null) {
                    break;
                }

                // Check the length of the array, don't linkify if there is an outstanding operator and this array does not match
                let typeA = getType(this.operand.length);
                let typeB = getType(match[0].split(',').length);
                switch (this.operator)
                {
                    case 'cross': if (typeB.length !== 3) { continue; } break;
                    case 'add':
                    case 'subtract':
                    case 'multiply':
                    case 'divide':
                    case 'dot':
                        if (typeA.length !== typeB.length && typeA.dimensions !== 0 && typeB.dimensions !== 0)
                        {
                            continue;
                        }
                        break;
                    default: break; // no length requirement
                }

                // Trim whitespace from the match
                let leadingMatch = match[0].match(this.leadingSeparatorExpr);
                let leadingSeparators = (leadingMatch === null ? 0 : leadingMatch[0].length);
                let trailingMatch = match[0].match(this.trailingSeparatorExpr);
                let trailingSeparators = (trailingMatch === null ? 0 : trailingMatch[0].length);

                // Linkify the text
                let range = new Range(new Position(i, match.index + leadingSeparators), new Position(i, match.index + match[0].length - trailingSeparators));
                let commandUri = 'command:vectorcalculator.setOperand?' + JSON.stringify(match[0]);
                links.push(new DocumentLink(range, Uri.parse(commandUri)));

                // Add decoration
                switch (typeB.dimensions)
                {
                    case 0: scalarDecorations.push({ range: range, hoverMessage: 'scalar' }); break;
                    case 1: vectorDecorations.push({ range: range, hoverMessage: 'vector' + typeB.length }); break;
                    case 2: matrixDecorations.push({ range: range, hoverMessage: 'matrix' + typeB.length + 'x' + typeB.length }); break;
                    default: break;
                }
            }

            if (window.activeTextEditor)
            {
                window.activeTextEditor.setDecorations(this.scalarDecorationType, scalarDecorations);
                window.activeTextEditor.setDecorations(this.vectorDecorationType, vectorDecorations);
                window.activeTextEditor.setDecorations(this.matrixDecorationType, matrixDecorations);
            }
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
        this.numberExpr.lastIndex = 0;
        let operand: number[] = [];
        while (true)
        {
            let match = this.numberExpr.exec(operandStr);
            if (match === null) {
                break;
            }
            operand.push(parseFloat(match[0]));
        }

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
            let resultStr = stringify(result);
            let message: string;
            if (this.operator.length === 0)
            {
                message = 'Select ' + resultStr;
            }
            else if (binaryOperator)
            {
                message = stringify(this.operand) + ' ' + this.operator + ' ' + stringify(operand) + ' = ' + resultStr;
            }
            else
            {
                message = this.operator + ' ' + stringify(this.operand) + ' = ' + resultStr;
            }
            this.report(message);
            binaryOperator = false;

            // Build the operator list
            let operators: QuickPickItem[] = [];
            let resultType = getType(result.length);

            // Output operations
            operators.push({ label: 'copy', description: resultStr });
            operators.push({ label: 'append', description: resultStr });

            // Dimension-specific operations
            if (resultType.dimensions === 1)
            {
                // Vector operations
                let labels = ['x', 'y', 'z', 'w'];
                for (let i = 0; i < resultType.length; i++)
                {
                    operators.push({ label: labels[i], description : result[i].toString()});
                }
                operators.push({ label: 'length', description: magnitude(result).toString() });
                operators.push({ label: 'normalize', description: stringify(normalize(result)) });
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
                    operators.push({ label: 'col' + i, description: stringify(column(result, i))});
                }
                operators.push({ label: 'transpose', description: stringify(transpose(result))});
            }

            // Common operations
            operators.push({ label: 'add' });
            operators.push({ label: 'subtract' });
            operators.push({ label: 'multiply' });
            operators.push({ label: 'divide' });
            operators.push({ label: 'reciprocal', description: stringify(reciprocal(result)) });

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
                case 'reciprocal': result = reciprocal(result); continue;
                case 'normalize': result = normalize(result); continue;
                case 'transpose': result = transpose(result); continue;

                // Output
                case 'copy':
                    clipboardy.write(stringify(result));
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
                this.report(stringify(this.operand) + ' ' + this.operator + ' ...');
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