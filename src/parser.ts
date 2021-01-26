export enum NodeType
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
export class Node
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

    close(end: number, parent: Node)
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
                type = NodeType.List;
            }
            if (this.items[i].items.length !== count)
            {
                count = -1;
            }
        }

        // Check if this is a list of scalars or a list of vectors with the same length
        if (type === NodeType.Scalar)
        {
            if (this.items.length === 1)
            {
                // Convert 1-vector to scalar
                this.type = NodeType.Scalar;
                this.begin = this.items[0].begin;
                this.end = this.items[0].end;
                this.items = [];
            }
            else
            {
                // N-vector
                this.type = NodeType.Vector;
            }
        }
        else if (type === NodeType.Vector && count > 1)
        {
            if (this.items.length === 1)
            {
                // Convert Nx1 matrix to vector
                this.type = NodeType.Vector;
                this.begin = this.items[0].begin;
                this.end = this.items[0].end;
                this.items = this.items[0].items;
            }
            else
            {
                // NxM matrix
                this.type = NodeType.Matrix;
            }
        } // else type remains none

        if (parent !== null)
        {
            parent.items.push(this);
        }
    }

    type: NodeType = NodeType.List;
    begin: number = -1;
    end: number = -1;
    delim: string = '';
    items: Node[] = [];
}

// Parses a line of text to find numerical values and returns them in a tree.
// For example if the line contains two 3-vectors, the tree will consist of a list node
// with one child for each of the vectors, each of which has one child for each element.
export function parse(line: string): Node
{
    let nodes:Node[] = [new Node(0, '')];
    let i:number = 0;
    let valid:boolean = true;
    while (i < line.length)
    {
        let c = line[i];

        if ('[({'.indexOf(c) >= 0)
        {
            // Opening delimiter - create a new node
            nodes.push(new Node(i, c));
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
                    let number = new Node(i, '');
                    number.end = next;
                    number.type = NodeType.Scalar;
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
    while (node.type === NodeType.List && node.items.length === 1)
    {
        node = node.items[0];
    }
    return node;
}