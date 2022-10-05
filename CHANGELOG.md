# Change Log

## 0.0.11
* Parser now accepts numbers with leading decimals, eg. .5, -.777e7

## 0.0.10
* New _rotation_ operator interprets 4-vectors as quaternions and converts them to matrices, eg. applying to (1, 0, 0, 0) gives ((1, 0, 0), (0, -1, 0), (0, 0, -1)), the 180 degree rotation about the x axis. Rotation matrices can be multiplied with 3-vectors to rotate them.
* Operations on hex32 values that give results that cannot be represented as a hex32 are automatically converted to decimal.

## 0.0.9

* Parser now automatically closes open delimiters
* Parser now accepts capital E and F, eg. 123E-4F = 123e-4f = 0.0123