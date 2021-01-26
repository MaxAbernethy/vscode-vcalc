export enum ValueMode
{
    Decimal,
    Hexadecimal
}

// Scalar, vector, or matrix. Matrices are stored in column-major order
export class Value extends Array<number>
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

    // Print a Value either as hex or dec
    stringify(mode: ValueMode): string
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

        switch(this.dimensions)
        {
            case 0: return stringifyScalar(this[0], mode);
            case 1: return stringifyVector(this, mode);
            case 2:
            {
                let matrix = '(';
                for (let i = 0; i < this.cols; i++)
                {
                    matrix += stringifyVector(this.col(i), mode);
                    if (i < this.cols - 1)
                    {
                        matrix += ', ';
                    }
                }
                return matrix + ')';
            }
            default: return 'error';
        }
    }

    rows: number;
}