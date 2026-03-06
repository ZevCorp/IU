"""
Flash Attention Compatibility Layer

This module provides a fallback implementation of flash_attn using standard PyTorch
when the actual flash_attn library is not available (e.g., on Jetson/ARM64).

Place this file in the HRM directory and it will be imported automatically.
"""

import torch
import torch.nn.functional as F
from typing import Optional


def flash_attn_func(
    q: torch.Tensor,
    k: torch.Tensor, 
    v: torch.Tensor,
    dropout_p: float = 0.0,
    softmax_scale: Optional[float] = None,
    causal: bool = False,
    **kwargs
) -> torch.Tensor:
    """
    Fallback implementation of flash_attn_func using PyTorch's scaled_dot_product_attention.
    
    Args:
        q: Query tensor of shape (batch, seqlen_q, num_heads, head_dim)
        k: Key tensor of shape (batch, seqlen_k, num_heads, head_dim)
        v: Value tensor of shape (batch, seqlen_k, num_heads, head_dim)
        dropout_p: Dropout probability
        softmax_scale: Scale for softmax (default: 1/sqrt(head_dim))
        causal: Whether to use causal attention
        
    Returns:
        Output tensor of shape (batch, seqlen_q, num_heads, head_dim)
    """
    # flash_attn uses (batch, seqlen, num_heads, head_dim)
    # PyTorch SDPA uses (batch, num_heads, seqlen, head_dim)
    
    batch_size, seqlen_q, num_heads, head_dim = q.shape
    
    # Transpose to PyTorch format
    q = q.transpose(1, 2)  # (batch, num_heads, seqlen_q, head_dim)
    k = k.transpose(1, 2)  # (batch, num_heads, seqlen_k, head_dim)
    v = v.transpose(1, 2)  # (batch, num_heads, seqlen_k, head_dim)
    
    # Compute scale
    if softmax_scale is None:
        softmax_scale = head_dim ** -0.5
    
    # Use PyTorch's scaled_dot_product_attention (available in PyTorch 2.0+)
    out = F.scaled_dot_product_attention(
        q, k, v,
        attn_mask=None,
        dropout_p=dropout_p if torch.is_grad_enabled() else 0.0,
        is_causal=causal,
        scale=softmax_scale
    )
    
    # Transpose back to flash_attn format
    out = out.transpose(1, 2)  # (batch, seqlen_q, num_heads, head_dim)
    
    return out
