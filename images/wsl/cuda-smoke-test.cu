#include <cuda_runtime.h>
#include <stdio.h>
int main() { int count = 0; if (cudaGetDeviceCount(&count) != cudaSuccess || count < 1) return 1; int *p = 0; if (cudaMalloc((void**)&p, sizeof(int)) != cudaSuccess) return 2; cudaFree(p); printf("cuda-ok:%d\n", count); return 0; }
